## Context

The Rust extraction pipeline now reports per-phase timing via `PipelineTiming` (serialized in `UniverseManifest.timing`). The vite-plugin displays this as a flat waterfall in verbose mode. But the JS wrapping around the NAPI call — file I/O, JSON serialization, Lightning CSS, per-file transforms — has 12 distinct operations with only 3 timed.

Current buildStart timing gaps (confirmed by source audit):
- File read loop (readFileSync × N + MD5 hash × N) — **zero timing**
- External package resolution (async Vite resolve + FS walk) — **zero timing**
- JSON.stringify(fileEntries) before NAPI call — **hidden inside "analysis" timing**
- JSON.parse(manifestJson) after NAPI call — **hidden inside "analysis" timing**
- Lightning CSS postProcessCss in load hook — **zero timing**
- Per-file transformFile NAPI calls — **zero aggregate timing**

Industry research (Rollup `--perf`, speed-measure-webpack, vite-plugin-inspect) confirms `performance.now()` with a no-op gate is the standard approach.

## Goals / Non-Goals

**Goals:**
- Complete timing coverage of all JS-side operations in both plugins
- Decompose the NAPI boundary into serialize + call + parse
- Aggregate per-file transform timing (min/max/avg/total)
- Zero overhead when verbose is off (Rollup-inspired no-op gate)
- Hierarchical waterfall display nesting JS phases around Rust phases
- Optional structured JSON output for CI perf tracking

**Non-Goals:**
- Changing any Rust timing code (already complete)
- Per-file timing breakdown (useful but adds hot-loop overhead — separate future concern)
- Tracing/flamegraph integration (future work, requires `node --prof` or `perf_hooks` PerformanceObserver)
- Memory tracking (Rollup does `[ms, mem_delta, total_mem]` — useful but adds complexity, defer)

## Decisions

### 1. Zero-cost timer gate via function replacement

```ts
const now = verbose ? () => performance.now() : () => 0;
const elapsed = verbose ? (t: number) => Math.round(performance.now() - t) : () => 0;
```

When `verbose` is false, `now()` returns 0 and `elapsed()` returns 0. No `performance.now()` calls, no math. The JIT will likely inline these to constants. This follows Rollup's pattern exactly.

**Why not conditional checks at each call site?** `if (verbose) { const t = performance.now(); }` at 20+ call sites is noisy. The function replacement centralizes the gate and reads cleanly: `const t = now(); /* work */ const ms = elapsed(t);`

### 2. Hierarchical timing tree as flat object with dot-notation keys

The timing data is stored as a flat `Record<string, number>` with hierarchical keys:

```ts
{
  "buildStart": 127,
  "buildStart.systemLoad": 29,
  "buildStart.fileDiscovery": 4,
  "buildStart.fileRead": 12,
  "buildStart.packageResolve": 8,
  "buildStart.analysis": 68,
  "buildStart.analysis.jsonSerialize": 5,
  "buildStart.analysis.rustExtract": 16,
  "buildStart.analysis.jsonParse": 2,
  "buildStart.lightningCss": 6,
  "buildStart.fileCount": 67,
  "buildStart.cacheHits": 0,
  "transform.total": 45,
  "transform.count": 67,
  "transform.min": 0,
  "transform.max": 3,
  "transform.avg": 0.67
}
```

The Rust `PipelineTiming` phases are merged under `buildStart.analysis.rustExtract.*` when building JSON output but displayed as nested indentation in the human-readable waterfall.

**Why flat object, not nested?** Simpler to serialize, grep-friendly in JSON output, no depth assumptions in the display code.

### 3. Waterfall display rewrite — two-level nesting

Replace the current flat `logTimingWaterfall(timing)` with a hierarchical display:

```
[animus] Extracted 194/200 components
[animus]   system-load         29ms
[animus]   file-discovery       4ms  (67 files)
[animus]   file-read+hash      12ms
[animus]   package-resolve      8ms  (2 packages)
[animus]   analysis            68ms
[animus]     json-serialize     5ms
[animus]     rust-extract      16ms
[animus]       parse+walk       0ms  (67 files, 0 cached)
[animus]       imports          0ms
[animus]       chains           2ms
[animus]       jsx-scan         2ms
[animus]       css-gen          2ms
[animus]       serialize        0ms
[animus]     json-parse         2ms
[animus]   lightning-css        6ms
[animus]   total              127ms
[animus] Transforms: 67 files, 45ms total (min 0ms, max 3ms, avg 0.7ms)
```

The existing `logTimingWaterfall` is refactored into a `logBuildTimings(jsTiming, rustTiming)` that composes both layers.

### 4. ANIMUS_TIMING_JSON=1 structured output

When `process.env.ANIMUS_TIMING_JSON === '1'`, after the human-readable waterfall, emit a single JSON line to stdout:

```
[animus:timing] {"buildStart":127,"buildStart.systemLoad":29,...,"rust.parseAndWalk":0,...}
```

Prefixed with `[animus:timing]` for grep extraction in CI. The JSON merges JS timing + Rust PipelineTiming into a single flat namespace. CI can diff two builds' JSON output to detect regressions.

### 5. Transform aggregate collector

A simple accumulator object reset at each `buildStart`:

```ts
const transformStats = { total: 0, count: 0, min: Infinity, max: 0 };
```

Each `transformFile()` call in the transform hook adds its duration. The stats are reported after all transforms complete (in the waterfall summary). In dev mode, stats accumulate across HMR cycles — the waterfall shows per-cycle stats.

## Risks / Trade-offs

- **[performance.now() precision]** → Sub-millisecond on all platforms. Rounding to integer ms matches Vite's own convention.
- **[Zero-cost gate correctness]** → If `verbose` changes mid-build (shouldn't happen), timings will be inconsistent. Acceptable — verbose is set once at configResolved.
- **[Flat key namespace collision]** → Dot-notation keys like `buildStart.analysis.rustExtract` could theoretically collide. Mitigated by using a fixed, documented key set.
- **[Transform stats in dev]** → In dev mode with HMR, transform stats accumulate per HMR cycle, not per full build. The waterfall already shows "HMR update" context so this is clear.
