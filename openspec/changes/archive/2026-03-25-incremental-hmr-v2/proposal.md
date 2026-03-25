## Why

HMR re-analysis re-parses every file on every change via `analyzeProject()`. By caching per-file extraction results in Rust and only re-parsing changed files, the Rust-side analysis drops from tens of milliseconds to ~2-3ms for single-file changes. Combined with skipping reconciliation in dev (only-grow strategy), the Rust crate does minimal work on incremental HMR.

This supersedes the original `incremental-hmr` proposal, which assumed `extract()` per-file results could be merged in JS. Deep exploration of the Rust crate revealed that `extract()` and `analyzeProject()` are fundamentally different — `extract()` does zero cross-file work (no import resolution, no extension provenance, no topo sort). The revised architecture keeps all analysis in Rust with a persistent per-file cache.

## What Changes

- **Rust-side per-file cache** in `project_analyzer.rs`: persistent `HashMap<String, CachedFileResult>` storing the full per-file evaluation result — ChainDescriptors, FileModuleInfo, ComponentCss, ComponentReplacement, active props, prop config, and JSX usage scan results — between `analyzeProject()` calls. Unchanged files skip OXC parsing entirely. Cached entries populate the `evaluated` working map so all downstream phases (extension merging, system_props population, CSS generation) operate correctly on cached data.
- **Content-hash integration**: plugin passes per-file content hashes to Rust so the crate knows which files to re-parse vs reuse from cache.
- **Dev-mode only-grow strategy**: incremental JSX scanning (scan only changed files, reuse cached scan results for unchanged files, merge via union) and skip reconciliation in dev. Never prune variants, states, system prop utilities, or components during dev. New system prop values are detected on the changed file and added to the CSS. All values ever encountered for a component are retained. Prod builds are unchanged (full analysis + reconciliation).
- **New NAPI parameter**: `analyzeProject()` gains optional `dev_mode` flag. `clearAnalysisCache()` added for geological resets.

## Capabilities

### New Capabilities
- `incremental-analysis-cache`: Rust-side persistent cache for per-file extraction results, dirty-file detection via content hashes, selective re-parsing
- `dev-mode-only-grow`: Dev-mode analysis that skips reconciliation and JSX usage scanning, retaining all variants/states/utilities monotonically

### Modified Capabilities
- `project-analyzer`: analyze_project gains caching behavior and dev-mode flag
- `vite-extraction-plugin`: handleHotUpdate passes content hashes and dev-mode flag to Rust

## Impact

- **Rust crate** (`packages/extract/`): `project_analyzer.rs` (primary), `lib.rs` (NAPI signature). No changes to css_generator, chain_walker, style_evaluator, transform_emitter, import_resolver, or reconciler.
- **Vite plugin** (`packages/vite-plugin/`): `handleHotUpdate` passes content hashes from existing `fileCache`. Adds `dev_mode` flag to `runAnalysis()` calls.
- **Tests**: New canary tests verifying cached analysis matches full re-analysis. Extension chain correctness with cached parents. Dev-mode reconciliation skip. Existing canary tests unaffected (they call `analyzeProject()` without caching).
- **Prod builds**: Completely unchanged. No caching, full analysis + reconciliation.
- **OXC arena safety**: Cached data uses owned Rust types (String, Vec, HashMap), not AST nodes. Arenas drop normally after parsing.

## Post-Implementation Assessment

### What worked
- **Rust cache is the core win.** 31/32 files skip OXC re-parsing. Rust-side analysis completes in ~2-3ms with cache hits. The cache design (pre-merge storage, owned types, content-hash keying) is correct and the canary tests confirm it.
- **Dev-mode only-grow is correct behavior.** Skipping reconciliation saves work and avoids dev-mode style flicker from variant/state pruning. Monotonic CSS growth is the right model for dev.
- **Geological reset is robust.** `clearAnalysisCache()` + full source re-send produces fresh results.

### What didn't deliver
- **Total HMR latency is ~60ms, not <10ms.** The original 57ms benchmark was total pipeline time (plugin → NAPI → Rust → NAPI → plugin → transforms → module invalidation). Rust analysis was always a subset of that. The JS overhead — JSON serialization of all file entries, NAPI boundary crossing, transform resolution, Vite module graph operations — creates a ~55-60ms floor that the Rust cache cannot address.
- **Surgical invalidation (`structuralSignature`) was premature.** Diffing component replacements to exclude system_props changes from module invalidation adds complexity (JSON.parse every config, track previous state, set diffing) but didn't reduce the 60ms total. Vite's module invalidation itself is cheap (flag flip); the cost is in the analysis + serialization pipeline that runs regardless.
- **Layer 1 early-exit not realized.** `PartialEq` was derived on ComponentCss (foundation for detecting style-unchanged re-parses) but no CSS regen gating was implemented. CSS generation always runs on the full component set. This is foundation for future per-component CSS patching but provides no current benefit beyond diagnostics.

### Serialization cost at scale
Every HMR cycle sends ALL tracked files to Rust (empty source for unchanged, full source for changed). For the 32-file showcase this is negligible, but for a code-split app with 200+ files, the O(total-files) iteration, JSON serialization, serde deserialization, and cross-file phase traversal will grow. Future optimization: send only changed files + path list for eviction, letting Rust use its cache exclusively for unchanged entries.

### Plugin-side optimizations shipped but not specified
Several plugin behaviors were developed during implementation to fix real bugs, not from the original design:
- `globalThis.__animus_component_sheet__` for idempotent adopted stylesheet (prevents duplication on HMR re-evaluation)
- `bridgeInjected` flag reset in `runAnalysis()` (ensures bridge injection after page reload)
- Transform subprocess restricted to prod; dev uses in-process `resolveTransformPlaceholders` (eliminates ~50ms subprocess overhead in dev)
- `buildFileEntriesFromCache` sends empty source for unchanged files (reduces serialization payload)

These are implementation details of the plugin's HMR pipeline, not cache architecture. They should be documented in the plugin's CLAUDE.md, not specified as capabilities.

### Recommendation for spec sync
- **Sync:** `incremental-analysis-cache`, `dev-mode-only-grow`, `project-analyzer` (NAPI changes) — these are correct, stable, permanent architecture.
- **Sync with revision:** `vite-extraction-plugin` — remove surgical invalidation from spec, keep content-hash passing and dev_mode flag.
- **Do not sync:** Surgical invalidation behavior. Consider removing `structuralSignature` and `prevReplacements` tracking from plugin in a future cleanup.
- **Future consideration:** Restructure NAPI interface to accept only changed files + path list (reduce O(total-files) cost). This would be a separate change.
