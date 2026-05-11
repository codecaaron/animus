## 1. Vite plugin: Timer gate and infrastructure

- [x] 1.1 Add `now()` and `elapsed()` zero-cost timer helpers after the `log()`/`warn()` functions — `performance.now()` when verbose, `() => 0` when not
- [x] 1.2 Add a `transformStats` accumulator object (`{ total, count, min, max }`) reset at each `buildStart` / HMR cycle
- [x] 1.3 Add a `buildTimings` record object to collect all JS-phase durations

## 2. Vite plugin: buildStart instrumentation

- [x] 2.1 Wrap `clearAnalysisCache()` call with timing
- [x] 2.2 Replace existing system-load `performance.now()` with `now()`/`elapsed()` gate pattern (preserve current timing point, just use new helpers)
- [x] 2.3 Replace existing file-discovery `performance.now()` with gate pattern
- [x] 2.4 Add timing around the file-read loop (readFileSync + contentHash for all files)
- [x] 2.5 Add timing around external package resolution block (resolve + FS walk + file reads)
- [x] 2.6 Decompose `runAnalysis()` — add separate timing for `JSON.stringify(fileEntries)`, the `analyzeProject()` NAPI call itself, and `JSON.parse(manifestJson)`
- [x] 2.7 Add timing around diagnostics/logging section
- [x] 2.8 Collect total buildStart wall time

## 3. Vite plugin: Transform and load hook timing

- [x] 3.1 In the `transform` hook, wrap `transformFile()` NAPI call with timing and accumulate into `transformStats`
- [x] 3.2 In the `load` hook, wrap `postProcessCss()` calls with timing — accumulate Lightning CSS total for the waterfall
- [x] 3.3 In `handleHotUpdate`, add timing around file-read + content-hash check

## 4. Vite plugin: Hierarchical waterfall display

- [x] 4.1 Refactor `logTimingWaterfall` into `logBuildTimings(buildTimings, rustTiming)` that renders hierarchical two-level output — JS phases at top level, Rust PipelineTiming phases nested under `analysis > rust-extract`
- [x] 4.2 Add transform summary line (`Transforms: N files, Xms total (min Yms, max Zms, avg Wms)`) after the waterfall
- [x] 4.3 Wire `logBuildTimings` into buildStart verbose path (replacing current `logTimingWaterfall` call)
- [x] 4.4 Wire `logBuildTimings` into HMR verbose path

## 5. Structured JSON output

- [x] 5.1 Add `ANIMUS_TIMING_JSON` env var check
- [x] 5.2 After human-readable waterfall, emit `[animus:timing] {json}` line merging JS `buildTimings` + Rust `PipelineTiming` into flat dot-notation keys
- [x] 5.3 Include transform stats in JSON output

## 6. Next plugin: Equivalent coverage

- [x] 6.1 Add `now()`/`elapsed()` zero-cost timer helpers to next-plugin
- [x] 6.2 Decompose analysis timing in `runFullPipeline()` — json-serialize, NAPI, json-parse
- [x] 6.3 Add `logBuildTimings` with hierarchical waterfall display
- [x] 6.4 Add `ANIMUS_TIMING_JSON` support

## 7. Verification

- [x] 7.1 Run `bun run verify:showcase` — full pipeline proof
- [x] 7.2 Run showcase build with `ANIMUS_DEBUG=1` — confirm hierarchical waterfall with JS + Rust phases
- [x] 7.3 Run showcase build with `ANIMUS_DEBUG=1 ANIMUS_TIMING_JSON=1` — confirm JSON timing line appears with all expected keys
- [x] 7.4 Run showcase build WITHOUT verbose — confirm zero timing output (no `performance.now()` calls via zero-cost gate)
