## Why

Every HMR update triggers a full re-analysis of ALL project files via `analyzeProject()` — currently ~57ms for 32 files (~2ms/file). This scales linearly: a 500-file app would pay ~900ms per save. The manifest is a materialized view of per-file contributions, and the Rust crate already has a per-file `extract()` function that runs in ~2ms. The pieces exist for incremental updates — we just need to assemble them.

## What Changes

- **Per-file extraction cache** in the Vite plugin: cache each file's `extract()` result (chains, ComponentCss, usage data)
- **Incremental HMR path**: on file change, re-extract ONLY the changed file, merge its delta into the cached manifest
- **Dev-mode "only grow" strategy**: never remove utility classes or component CSS during dev. Append new system prop values, keep all components rendered. Prod build does the clean sweep via full `analyzeProject()` + reconciliation.
- **Import-change detection**: cheap regex pre-check on `import.*from` statements. If imports didn't change, skip provenance re-resolution. If imports changed, fall back to full re-analysis (rare during active dev).
- **Transactional manifest updates**: plugin-side JS merges per-file extraction deltas into the existing manifest without calling `analyzeProject()`.

## Capabilities

### New Capabilities
- `incremental-extraction`: Per-file extraction caching + delta merging for O(1) HMR updates regardless of project size
- `dev-mode-growth-strategy`: Dev-mode "only grow, never shrink" approach to utility CSS and component CSS — prod reconciliation handles cleanup

### Modified Capabilities

## Impact

- `packages/vite-plugin/src/index.ts` — per-file cache, incremental HMR path, import-change detection
- `packages/extract` — no Rust changes needed initially. `extract()` per-file already exists. Future: optional `merge_manifest()` NAPI function for Rust-side merging.
- HMR latency: ~57ms → <5ms for single-file changes regardless of project size
- Geological resets (ds.ts, config changes): unchanged, still full re-analysis
- Production builds: unchanged, still full `analyzeProject()` + reconciliation
- Depends on `static-adopted-split` for animation-safe CSS delivery of incremental updates
