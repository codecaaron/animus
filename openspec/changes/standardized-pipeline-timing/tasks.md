## 1. Rust: PipelineTiming struct

- [x] 1.1 Define `PipelineTiming` struct in `project_analyzer.rs` with `#[derive(Serialize)]` and `#[serde(rename_all = "camelCase")]` — fields: `parse_and_walk`, `import_resolution`, `extension_provenance`, `topological_sort`, `chain_evaluation`, `jsx_scanning`, `system_prop_aggregation`, `usage_ledger`, `reconciliation`, `css_generation`, `manifest_serialization` (all `u64`), plus `file_count: usize`, `cache_hits: usize`, `total_ms: u64`
- [x] 1.2 Add `timing: PipelineTiming` field to `UniverseManifest` struct

## 2. Rust: Instrument phase boundaries

- [x] 2.1 Add `use std::time::Instant;` and place `Instant::now()` + `.elapsed().as_millis()` at Phase 1 boundary (parse + walk chains, lines ~307–383), capturing `file_count` and `cache_hits` from the existing cache check
- [x] 2.2 Instrument Phase 2 (import resolution, lines ~399–430) and Phase 3 (extension provenance, lines ~441–487)
- [x] 2.3 Instrument Phase 4 (topological sort, lines ~490–530) and Phase 5a (chain evaluation, line ~532)
- [x] 2.4 Instrument Phase 5b (JSX scanning, line ~788), Phase 5c (system prop aggregation, line ~1192), Phase 5d (usage ledger, line ~1240), Phase 5e (reconciliation, line ~1298)
- [x] 2.5 Instrument Phase 6 (CSS generation, lines ~1325–1370) and Phase 7 (manifest serialization, line ~1449+)
- [x] 2.6 Wrap entire `analyze_project` body in a top-level `Instant::now()` for `total_ms`, construct `PipelineTiming` and assign to manifest before serialization

## 3. Vite plugin: Waterfall display

- [x] 3.1 Read `manifest.timing` after `analyzeProject()` JSON parse in `runAnalysis()`
- [x] 3.2 Add a `logTimingWaterfall(timing)` helper function that formats the indented phase-by-phase display with right-aligned millisecond values
- [x] 3.3 Call `logTimingWaterfall` in `buildStart` verbose path after the existing extraction summary line
- [x] 3.4 Call `logTimingWaterfall` in HMR `handleHotUpdate` verbose path after the existing HMR timing line

## 4. Next plugin: Waterfall display

- [x] 4.1 Add the same `logTimingWaterfall` helper (extract as shared utility or inline — next-plugin is separate package)
- [x] 4.2 Read `manifest.timing` after `analyzeProject()` parse and display in verbose mode during `run`/`watchRun` hooks

## 5. Verification

- [x] 5.1 Run `cargo test` — ensure PipelineTiming serialization doesn't break existing manifest tests
- [x] 5.2 Run `bun run verify:showcase` — full pipeline proof with timing present in manifest
- [x] 5.3 Run showcase dev server with `ANIMUS_DEBUG=1` and confirm waterfall output appears with reasonable per-phase numbers
