## Context

System module loading currently works as a subprocess:
1. Plugin constructs a CJS script string that `require()`s the system file
2. `execSubprocess()` writes script to tmpfile, runs `bun run <tmpfile>` via `execSync`
3. Subprocess writes serialized config to a JSON tmpfile
4. Plugin reads the JSON tmpfile and parses it

This works but the subprocess exists solely because Node can't `require()` a `.ts` file. Bun can — so we spawn bun. The actual work (import module, call .toConfig(), call .serialize()) is ~2-3ms; the remaining cost is process spawn + module cache warm-up (bimodal: cold ~30ms, warm with bun cache ~10ms).

The Rust crate already has every capability needed to replace this:
- `oxc_transformer` + `oxc_codegen` for TS → JS type-stripping (used in `transform_extractor.rs::strip_typescript()`)
- `import_resolver.rs` patterns for resolving import specifiers to file paths

The missing piece is a JS engine capable of executing full ESM modules with import/export. rquickjs (QuickJS bindings) provides exactly this with its Module API and Resolver/Loader traits. boa_engine was added recently for transform evaluation but rquickjs can handle both workloads — one engine instead of two.

## Goals / Non-Goals

**Goals:**
- Single NAPI function that any plugin calls to load a system module — no subprocess, no bundler dependency
- Replace boa_engine with rquickjs as the single JS engine in the crate
- Consistent system loading latency (~6-12ms, no cold/warm bimodal variance)
- Reuse existing OXC infrastructure for type-stripping
- Pre-resolve all dependencies in Rust; rquickjs only executes, never touches filesystem

**Non-Goals:**
- General-purpose JS bundling in Rust (we only load system files and their known deps)
- Supporting arbitrary system files with dynamic imports or non-package deps
- Modifying the SystemInstance/theme serialization API (.toConfig(), .serialize() stay as-is)

## Decisions

### 1. rquickjs replaces boa entirely

**Choice:** Replace boa_engine with rquickjs 0.11. One JS engine for both module execution (system loading) and expression evaluation (transforms).

**Why:** QuickJS has a bytecode-compiled register-based VM — faster than boa's interpreter for both module chains and expression snippets. boa was added recently (no legacy attachment). Having two JS engines in one crate is unnecessary complexity. rquickjs's `Context::eval()` covers the same `eval(Source::from_bytes(...))` pattern boa uses in `TransformEvaluator`.

**Migration:** `TransformEvaluator` keeps its API surface (`register()`, `evaluate()`). Internal implementation changes from `boa_engine::Context` to `rquickjs::Context`. The `Context::eval()` call is equivalent.

### 2. Two-map Resolver/Loader — not a flat HashMap

**Choice:** The rquickjs Resolver and Loader are backed by separate data structures:
- **Resolver**: receives `(base: &str, specifier: &str)` → returns canonical path. Handles relative specifiers contextually by resolving against the base module's directory.
- **Loader**: receives canonical path → returns pre-processed source via `Module::declare()`.

**Why:** rquickjs's `Resolver` trait receives the importing module's path plus the raw import specifier. A flat `HashMap<specifier, source>` cannot resolve `("@animus-ui/test-ds/dist/index.mjs", "@animus-ui/system")` — it needs to know the base to resolve relative imports. The Resolver handles the relational step (base + specifier → canonical path); the Loader handles the content step (path → source).

**Resolver implementation:**
```
fn resolve(ctx, base, name) -> Result<String> {
    if name starts with '.' or '/' → resolve relative to dirname(base), with extension probing
    else → look up in pre-built bare_specifier_map: HashMap<String, String>
}
```

**Loader implementation:**
```
fn load(ctx, canonical_path) -> Result<Module> {
    let source = pre_loaded_sources.get(canonical_path)?;
    Module::declare(ctx, canonical_path, source)
}
```

### 3. Package.json resolution with fallback chain

**Choice:** Resolve bare specifiers via: `exports` map (`import` condition) → `module` field → `main` field.

**Why:** Not all packages have an `exports` field. `@animus-ui/test-ds` has only `module` and `main`. The Node.js resolution algorithm falls back through these fields. Our resolver must do the same.

**Resolution pipeline:**
1. Find `node_modules/<package>/package.json` by walking up from `root_dir`
2. If `exports` exists: match the subpath (`.` for root, `./groups` for subpath), follow the `import` condition within any nested condition objects
3. If no `exports` or no match: try `module` field
4. If no `module`: try `main` field
5. Resolve the resulting relative path against the package directory

### 4. Recursive dependency parsing including pre-built files

**Choice:** Parse ALL resolved files (including pre-built `.mjs` dist files) for their own import statements. Recursively resolve and pre-load the entire transitive dependency graph before rquickjs execution begins.

**Why:** Pre-built dist files re-import from other packages. `@animus-ui/test-ds/dist/index.mjs` imports from `@animus-ui/system` and `@animus-ui/system/groups`. If we only parse the user's system file for imports but skip pre-built deps, rquickjs will fail when test-ds tries to import @animus-ui/system at runtime. The Resolver/Loader must have ALL transitive deps pre-loaded.

**Pipeline:**
1. Parse system file → extract imports → resolve → read
2. For each resolved file: if `.ts`/`.tsx` → OXC strip types; if `.js`/`.mjs` → read as-is
3. Parse each resolved file for ITS OWN imports → resolve → read (recursion)
4. Deduplicate: if a canonical path is already in the source map, skip (prevents cycles and avoids re-processing `@animus-ui/system` imported by both ds.ts and test-ds)
5. Continue until no new unresolved imports remain

### 5. Full-module type stripping via existing OXC pipeline

**Choice:** Scale up `strip_typescript()` to handle full module files — parse as module, transform, codegen the complete program. Simpler than the current expression-wrapping approach.

### 6. NAPI function with optional export name

**Choice:** `loadSystemModule(systemPath, rootDir, exportName?)` — optional parameter lets the caller specify which export to use, with duck-typing fallback.

```rust
#[napi(object)]
pub struct SystemConfig {
    pub prop_config: String,
    pub group_registry: String,
    pub scales_json: String,
    pub variable_map_json: String,
    pub variable_css: String,
    pub contextual_vars_json: String,
    pub selector_aliases: Option<String>,
    pub selector_order: Option<String>,
    pub global_style_blocks: Option<String>,
}
```

**Export extraction:**
- If `exportName` provided: use that export directly, call `.toConfig()`
- If not provided: iterate namespace, find export with `.toConfig()` (duck-typing)
- Theme: look for export named `tokens` or `theme` with `.serialize()`
- GlobalStyleBlocks: iterate exports, find objects with `__brand === 'GlobalStyleBlock'`

## Risks / Trade-offs

**[Build time increase]** → QuickJS C compilation adds ~30s to first `cargo build`. Cached after. Mitigated by release profile LTO already being slow.

**[Binary size]** → rquickjs replaces boa. QuickJS (C) vs boa (pure Rust) — similar binary footprint. Net change minimal.

**[Package.json resolution edge cases]** → Complex exports maps with nested conditions, wildcard patterns. → Mitigate: support `import` condition + `module`/`main` fallback. Fail clearly on unresolvable specifiers with diagnostic listing what was tried.

**[Performance expectations]** → Projected ~6-12ms (QuickJS bytecode compile + dep resolution I/O + execution). Comparable to warm subprocess (~10ms), eliminates cold-start variance (30ms). The primary win is architectural (bundler independence, subprocess elimination, testability), not raw speed.

**[System files with unexpected imports]** → Dynamic imports, side-effect-heavy deps, or packages without built dist/ will fail. → Mitigate: clear error messages with resolution trace.
