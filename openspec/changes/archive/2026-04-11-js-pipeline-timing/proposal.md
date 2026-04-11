## Why

The previous change (`standardized-pipeline-timing`) instrumented the Rust extraction phases inside `analyzeProject()`. But the JS plugin wrapping has 12 distinct operations in `buildStart` and only 3 are timed. The hidden JS costs — file I/O, JSON serialization across the NAPI boundary, Lightning CSS post-processing, per-file transforms — are completely invisible. Every optimization decision about the JS layer is speculation without this data.

Industry research confirms `performance.now()` with a zero-cost gate (Rollup's pattern) is the standard approach. Tailwind and vanilla-extract have zero timing instrumentation — we're already ahead of the field after the Rust work, this closes the JS gap.

## What Changes

- **Zero-cost timer gate:** `now()` and `elapsed()` helpers that become no-ops when `verbose` is false — zero overhead in production
- **buildStart full coverage:** Wrap all 12 operations with timing — system-load, file-discovery, file-read+hash, package-resolve, JSON serialize, NAPI call, JSON parse, diagnostics
- **Analysis decomposition:** Break the single "analysis" timing into three sub-phases — `JSON.stringify(fileEntries)`, Rust NAPI `analyzeProject()`, and `JSON.parse(manifestJson)` — so NAPI boundary costs are visible alongside the Rust `PipelineTiming`
- **Aggregate transform timing:** Collect `transformFile()` NAPI call durations per build, report min/max/avg/total in verbose output
- **Lightning CSS timing:** Time `postProcessCss()` WASM calls in load hooks
- **HMR timing gaps:** Time file-read + content-hash check in `handleHotUpdate`
- **Hierarchical waterfall display:** JS phases wrap around existing Rust `PipelineTiming` as nested sub-tree, replacing the flat waterfall with a two-level view
- **Structured JSON output:** `ANIMUS_TIMING_JSON=1` env var emits the complete timing tree as a single JSON blob for CI regression tracking
- **Next-plugin equivalent:** Same timer gate, analysis decomposition, and waterfall display

## Capabilities

### New Capabilities
- `js-pipeline-timing`: Zero-cost JS-side timing instrumentation across vite-plugin and next-plugin — buildStart phases, transform aggregates, Lightning CSS, HMR, structured JSON output

### Modified Capabilities
- `pipeline-timing`: Hierarchical waterfall now nests JS phases around Rust phases; `ANIMUS_TIMING_JSON` structured output
- `vite-extraction-plugin`: Verbose waterfall expands from Rust-only to full JS+Rust hierarchy; transform aggregate timing; Lightning CSS timing
- `next-webpack-integration`: Verbose waterfall expands to full JS+Rust hierarchy

## Impact

- **Vite plugin:** `index.ts` — timer helpers, buildStart instrumentation, transform aggregate collector, load hook timing, waterfall display rewrite
- **Next plugin:** `plugin.ts` — same timer helpers, analysis decomposition, waterfall display
- **No Rust changes** — `PipelineTiming` and `UniverseManifest` are unchanged
- **No new dependencies** — `performance.now()` is from `node:perf_hooks` (Node.js stdlib)
- **No behavioral changes** — pure observability addition
