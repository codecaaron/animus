## Why

HMR re-analysis takes ~57ms for 32 files because `analyzeProject()` re-parses every file on every change. OXC parsing accounts for ~84% of this time (~1.5ms/file x 32). The cross-file analysis phases (import resolution, topo sort, extension merging, CSS generation) are fast (~9ms total). By caching per-file extraction results in Rust and only re-parsing changed files, HMR drops to ~7-11ms. Combined with skipping reconciliation in dev (only-grow strategy), the target is <5ms for single-file style edits.

This supersedes the original `incremental-hmr` proposal, which assumed `extract()` per-file results could be merged in JS. Deep exploration of the Rust crate revealed that `extract()` and `analyzeProject()` are fundamentally different — `extract()` does zero cross-file work (no import resolution, no extension provenance, no topo sort). The revised architecture keeps all analysis in Rust with a persistent per-file cache.

## What Changes

- **Rust-side per-file cache** in `project_analyzer.rs`: persistent `HashMap<String, CachedFileResult>` storing the full per-file evaluation result — ChainDescriptors, FileModuleInfo, ComponentCss, ComponentReplacement, active props, prop config, and JSX usage scan results — between `analyzeProject()` calls. Unchanged files skip OXC parsing entirely. Cached entries populate the `evaluated` working map so all downstream phases (extension merging, system_props population, CSS generation) operate correctly on cached data.
- **Content-hash integration**: plugin passes per-file content hashes to Rust so the crate knows which files to re-parse vs reuse from cache.
- **Dev-mode only-grow strategy**: incremental JSX scanning (scan only changed files, reuse cached scan results for unchanged files, merge via union) and skip reconciliation in dev. Never prune variants, states, system prop utilities, or components during dev. New system prop values are detected on the changed file and added to the CSS. All values ever encountered for a component are retained. Prod builds are unchanged (full analysis + reconciliation).
- **Early-exit layers**: Layer 0 (content hash, already exists in plugin), Layer 1 (ComponentCss unchanged after re-parse — skip CSS regen), Layer 2 (ComponentCss changed — replace cache entry, regenerate).
- **New NAPI parameter or entry point**: `analyzeProject()` gains an optional `file_hashes` parameter (or a separate `analyze_project_incremental()` function) plus a `dev_mode` flag to skip reconciliation.

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
- **Tests**: New canary test verifying cached analysis matches full re-analysis. Existing canary tests unaffected (they call `analyzeProject()` without caching).
- **Prod builds**: Completely unchanged. No caching, full analysis + reconciliation.
- **OXC arena safety**: Cached data uses owned Rust types (String, Vec, HashMap), not AST nodes. Arenas drop normally after parsing.
