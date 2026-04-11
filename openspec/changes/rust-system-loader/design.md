## Context

System module loading currently works as a subprocess:
1. Plugin constructs a CJS script string that `require()`s the system file
2. `execSubprocess()` writes script to tmpfile, runs `bun run <tmpfile>` via `execSync`
3. Subprocess writes serialized config to a JSON tmpfile
4. Plugin reads the JSON tmpfile and parses it

This works but the subprocess exists solely because Node can't `require()` a `.ts` file. Bun can — so we spawn bun. The actual work (import module, call .toConfig(), call .serialize()) is ~2-3ms; the remaining cost is process spawn + module cache warm-up.

The Rust crate already has every capability needed to replace this:
- `oxc_transformer` + `oxc_codegen` for TS → JS type-stripping (used in `transform_extractor.rs::strip_typescript()`)
- `import_resolver.rs` patterns for resolving import specifiers to file paths
- `boa_engine` for JS execution (used in `transform_evaluator.rs`)

The missing piece is a JS engine capable of executing full ESM modules with import/export — boa can eval snippets but rquickjs has a proper Module API with Resolver/Loader traits.

## Goals / Non-Goals

**Goals:**
- Single NAPI function that any plugin calls to load a system module — no subprocess, no bundler dependency
- Consistent low-ms system loading with no cold/warm variance
- Reuse existing OXC infrastructure for type-stripping
- Pre-resolve all dependencies in Rust; rquickjs only executes, never touches filesystem

**Non-Goals:**
- Replacing boa_engine for transform evaluation (boa stays for simple `(v) => v + "px"` snippets)
- General-purpose JS bundling in Rust (we only load system files and their known deps)
- Supporting arbitrary system files with dynamic imports, side effects, or non-package deps
- Modifying the SystemInstance/theme serialization API (.toConfig(), .serialize() stay as-is)

## Decisions

### 1. rquickjs over boa for module execution

**Choice:** Add rquickjs 0.11 for full module execution. Keep boa for transform eval.

**Why:** QuickJS has a bytecode-compiled register-based VM — significantly faster than boa's interpreter for non-trivial code. The system file executes hundreds of chained method calls (createTheme with 10 color scales, 10 color modes, 12 token scales; createSystem with 6 groups). rquickjs's Module API provides Resolver/Loader traits purpose-built for custom module resolution.

**Why not boa modules:** Boa 0.21 has a Module API but: (a) execution speed matters for real module chains, (b) the async Promise-based API adds complexity, (c) rquickjs's Resolver/Loader trait pair maps directly to our "pre-resolved HashMap" pattern.

**Why not just keep subprocess:** Subprocess couples to a JS runtime being available (bun/node), forces each plugin to implement loading independently, and has bimodal latency. The NAPI function is a better abstraction boundary.

### 2. Rust-side dependency resolution, not JS-side

**Choice:** Resolve all import specifiers in Rust before feeding to rquickjs. The rquickjs Resolver is a trivial HashMap lookup. The Loader returns pre-read, pre-processed source.

**Why:** We already walk the dependency graph in `import_resolver.rs`. Package.json exports map resolution is straightforward string matching. The system file's deps are workspace packages with built `dist/` artifacts — no complex bundler resolution needed. This means rquickjs has zero filesystem access and zero resolution logic.

**Dependency resolution pipeline:**
1. Read system file, OXC parse to extract import declarations
2. For each bare specifier (e.g. `@animus-ui/system`): find package.json → read `exports` map → resolve to dist file path
3. For each relative specifier (e.g. `./helpers`): resolve against system file directory
4. Recursively process each resolved file (strip types if .ts, read as-is if .js)
5. Build `HashMap<String, String>` of canonical_path → processed_source
6. Feed to rquickjs Resolver/Loader

### 3. Full-module type stripping via existing OXC pipeline

**Choice:** Scale up `strip_typescript()` from transform_extractor.rs to handle full module files (not just callback expressions).

**Current `strip_typescript()`:** Wraps source in `const __x = <expr>;`, transforms, extracts the expression back. This works for single expressions.

**Full-module version:** Parse the entire file as a module, run `oxc_transformer::Transformer` on the full program, codegen the complete program. Simpler than the current expression-wrapping approach.

### 4. NAPI function returns structured result, not raw JSON strings

**Choice:** `loadSystemModule()` returns a structured NAPI object with typed fields:

```rust
#[napi(object)]
pub struct SystemConfig {
    pub prop_config: String,       // JSON
    pub group_registry: String,    // JSON
    pub scales_json: String,       // JSON (flat token map)
    pub variable_map_json: String, // JSON (token path → CSS var)
    pub variable_css: String,      // CSS string (:root blocks)
    pub contextual_vars_json: String, // JSON
    pub selector_aliases: Option<String>,  // JSON or null
    pub selector_order: Option<String>,    // JSON or null
    pub global_style_blocks: Option<String>, // JSON or null
}
```

**Why:** Eliminates the JSON-in-JSON pattern of the subprocess (write JSON to file, read file, parse). The NAPI boundary handles serialization natively.

### 5. Export extraction via rquickjs object traversal

**Choice:** After module execution, traverse rquickjs's JsValue to find SystemInstance and theme exports, then call their methods from Rust.

**Pattern:**
```
module.namespace() → iterate exports → find one with .toConfig() → call it
                                     → find one with .serialize() → call it
                                     → find GlobalStyleBlock exports
```

This mirrors the subprocess script's logic but executes in-process via rquickjs's Rust API.

## Risks / Trade-offs

**[Binary size increase]** → rquickjs embeds QuickJS (C library). Expected ~200-400KB increase to the .node binary. Acceptable for a build tool.

**[Build time increase]** → QuickJS C compilation adds ~30s to first `cargo build`. Cached after. Mitigated by release profile LTO already being slow.

**[Two JS engines in one crate]** → boa for transforms, rquickjs for modules. Adds conceptual complexity. → Future option: migrate transform eval to rquickjs too, removing boa. Not in scope for this change.

**[Package.json exports resolution edge cases]** → Complex exports maps with conditions (`import`, `require`, `default`, `node`, `browser`) need correct condition matching. → Mitigate: follow the `import` condition (system files are ESM). Fail clearly on unresolvable specifiers.

**[System files with unexpected imports]** → If a system file imports from a package without built dist/, or uses dynamic imports, this will fail. → Mitigate: clear error messages. The subprocess path can remain as a fallback behind a flag during migration.
