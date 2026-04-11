## Why

The extraction pipeline has zero internal timing visibility. The vite-plugin measures wall-clock time around the entire `analyzeProject()` call (~1 number), but we can't see where time is spent across the 7 phases and 5 sub-phases inside the Rust crate. Every optimization proposal (parse consolidation, source maps, subprocess elimination) is speculation without per-phase baselines. The next-plugin has a `verbose` flag but no timing at all.

## What Changes

- Add `std::time::Instant` instrumentation to each phase boundary in `project_analyzer.rs`
- Define a `PipelineTiming` struct that collects per-phase durations in milliseconds
- Serialize timing data into the `UniverseManifest` JSON (new `timing` field)
- Vite-plugin reads `manifest.timing` and displays phase-by-phase breakdown in verbose mode
- Next-plugin gets equivalent timing display using the same manifest timing data
- Per-file `extract()` function gets optional timing in its `ExtractionResult`
- Standardized phase names shared across Rust struct fields and JS display

## Capabilities

### New Capabilities
- `pipeline-timing`: Structured per-phase timing instrumentation across Rust extraction pipeline and JS plugin display

### Modified Capabilities
- `extract-pipeline`: UniverseManifest gains a `timing` field; ExtractionResult gains optional timing
- `vite-extraction-plugin`: Verbose output expands from single total to per-phase waterfall
- `next-webpack-integration`: Verbose output gains timing display (currently has none)

## Impact

- **Rust crate**: `project_analyzer.rs` (phase boundaries), `lib.rs` (ExtractionResult, UniverseManifest structs)
- **Vite plugin**: `index.ts` verbose logging section
- **Next plugin**: `plugin.ts` verbose logging
- **NAPI boundary**: UniverseManifest JSON shape gains `timing` object (additive, non-breaking)
- **TypeScript types**: `index.d.ts` auto-generated from Rust `#[napi(object)]` — gains timing fields
- **Dependencies**: None new (`std::time` is stdlib)
