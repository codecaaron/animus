## Context

The Vite plugin spawns 3 sequential bun subprocesses during `buildStart`, each importing the same system module and calling `.toConfig()`. The subprocess model was originally necessary because the system module is ESM TypeScript that can't be `require()`'d directly in Node. This design eliminates 2 of the 3 subprocesses by:

1. Enforcing that `createTransform` callbacks are self-contained (no external references)
2. Having Rust extract the callback source spans from the AST
3. Moving global styles resolution into Rust's `analyzeProject` (theme_resolver already handles the hard parts)
4. Generating a tiny zero-dep CJS bin file from extracted transform sources to resolve `__TRANSFORM__` placeholders

Current subprocess responsibilities:
- **Subprocess 1** (system load): Import system module, call `.toConfig()` + `.serialize()`, discover global style blocks, discover transform names → JSON output
- **Subprocess 2** (global styles): Import system module AGAIN, call `.toConfig()` AGAIN, resolve global style blocks with live transforms → resolved CSS
- **Subprocess 3** (transforms): Import system module AGAIN, call `.toConfig()` AGAIN, regex-replace `__TRANSFORM__` placeholders → resolved CSS

## Goals / Non-Goals

**Goals:**
- Eliminate subprocess 2 (global styles) by moving resolution to Rust
- Eliminate subprocess 3 (transforms) by extracting transform source spans in Rust and resolving via a generated bin file
- Reduce `buildStart` overhead by ~200ms+ (2 fewer process spawns)
- Remove bun requirement for transform and global styles resolution
- Enforce self-contained transform constraint at extraction time with clear diagnostics

**Non-Goals:**
- Eliminating subprocess 1 — system module evaluation requires a JS runtime (it's live TypeScript)
- Implementing transforms natively in Rust — the bin file approach preserves user-defined JS transforms
- Changing transform semantics or output — identical CSS output before and after
- Supporting transforms with external references — this is explicitly out of scope and enforced

## Decisions

### Decision 1: Self-contained constraint over dependency tracing

**Choice:** Enforce that `createTransform` callbacks have no external references, rather than building a dependency tracer in Rust.

**Why:** Dependency tracing (finding imports used by the callback, their transitive deps, inlining them) is essentially building a mini-bundler in Rust. The transforms in practice are simple pure functions — `size` is 10 lines, `borderShorthand` is 1 line. Inlining the 2-3 helper functions they currently use is 30 minutes of work. The constraint eliminates an entire class of complexity.

**Alternative considered:** Bundling transform files with esbuild before Rust analysis. This works but adds esbuild as a runtime dependency in the build path and doesn't leverage Rust's existing AST capabilities.

### Decision 2: Bin file post-processor over in-process eval

**Choice:** Write extracted transform sources to a CJS file and run it via `execSync`, rather than using `new Function()` or `eval()` in the plugin.

**Why:** `new Function()` is blocked by CSP policies in some environments. `eval()` has the same issue plus security concerns. A CJS file with zero dependencies runs anywhere — node, bun, deno. The exec cost is ~15-30ms (vs ~100ms+ for a subprocess that needs to import the system module and resolve TS).

**Alternative considered:** Direct `await import()` of the system module under bun. Works when bun is the Vite runtime, but fails under Node without a TS loader. The bin file is runtime-agnostic.

### Decision 3: Global styles into Rust's analyzeProject

**Choice:** Pass raw global style block objects into `analyzeProject` as a new parameter. Rust resolves them using the same theme_resolver pipeline as component styles. Transform values emit `__TRANSFORM__` placeholders resolved by the bin file.

**Why:** theme_resolver already handles prop shorthand expansion, scale lookup, and token alias resolution. The only missing piece was live transform execution — which the bin file now covers via placeholders. This means global styles and component styles use the same resolution path. Single source of truth.

**Alternative considered:** Consolidating all 3 subprocesses into 1 (resolving global styles in the existing subprocess). This saves 2 process spawns but keeps JS responsible for resolution logic that Rust already implements. It's a half-measure.

### Decision 4: Transform extraction via AST in project_analyzer, not chain_walker

**Choice:** Scan for `createTransform` calls during the project_analyzer's parse phase, not in chain_walker.

**Why:** chain_walker is scoped to finding builder chain terminals (`.asElement`, `.asComponent`, `.asClass`). Transform extraction is a separate concern — it needs to find `createTransform` calls which may appear in different files than the builder chains (e.g., `transforms/size.ts` has no builder chains). Adding it to project_analyzer's parse phase means it runs on ALL files during the existing AST walk, with results collected into the manifest.

### Decision 5: External reference validation via free variable analysis

**Choice:** After extracting the callback AST, walk it to find all `Identifier` references. Compare against: parameter names, locally declared variables, and a well-known globals allowlist (`String`, `Number`, `Math`, `parseInt`, `parseFloat`, `isNaN`, `RegExp`, `JSON`, `Array`, `Object`, `undefined`, `NaN`, `Infinity`, `console`). Any unresolved identifier → diagnostic.

**Why:** This is sound and complete for the constraint we're enforcing. If an identifier isn't a parameter, a local, or a well-known global, it must be an external reference. The AST gives us exact span information for the diagnostic message.

### Decision 6: Subprocess 1 output changes

**Choice:** The system load subprocess continues to discover global style blocks from module exports, but ships them as raw JSON objects (`{ selectorMap: { selector: { prop: value } } }`) instead of resolved CSS. It also stops extracting transform function names (Rust discovers them from source).

**Why:** The subprocess's job is to evaluate the live TypeScript module — things that require a JS runtime. Prop resolution, scale lookup, and transform extraction are static analysis tasks that Rust handles better. Subprocess 1 should do the minimum irreducible JS work.

## Risks / Trade-offs

**[Risk] Built-in transform helper inlining creates code duplication** → `percentageOrAbsolute` (~5 lines) appears in `size`'s callback body instead of being imported. This is 5 lines duplicated in one place. Acceptable for the constraint it enables. The helper functions (`percentageOrAbsolute`, `numberToTemplate`) can remain exported for non-extraction use — they just can't be referenced from within a `createTransform` callback.

**[Risk] Users with existing external-reference transforms get a build error** → The extraction diagnostic is actionable: it names the external symbol and explains the constraint. Users inline the reference. This is a one-time migration. The `strict: false` default means it warns rather than fails — the transform falls through to unresolved `__TRANSFORM__` placeholder (which the bin file won't have a function for, so the raw value passes through).

**[Risk] Bin file exec adds a process spawn** → True, but it's ~15-30ms (zero-dep CJS, no module resolution, no TS compilation) vs the ~100-120ms it replaces (full system module import + TS eval). Net savings: ~70-90ms per subprocess eliminated, times 2 = ~140-180ms.

**[Risk] Global styles in Rust creates a new code path** → theme_resolver already resolves styles identically for components. Global styles are structurally the same: `{ selector: { prop: value } }`. The new code is primarily wiring (accepting the parameter, iterating blocks, calling existing resolution functions, wrapping in `@layer anm-global`). The resolution logic itself is unchanged.

**[Risk] `__TRANSFORM__` in global styles changes behavior** → Currently global styles resolve transforms directly (live JS). After this change, they go through the same placeholder → bin file path as component styles. The output is identical, but the resolution timing shifts from subprocess 2 to post-analysis. If a transform function has side effects (it shouldn't — they're pure), this could differ. Mitigation: transforms are documented as pure functions; the self-contained constraint reinforces this.
