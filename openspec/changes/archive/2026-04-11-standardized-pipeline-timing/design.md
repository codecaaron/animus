## Context

The extraction pipeline in `project_analyzer.rs` executes 7 distinct phases with Phase 5 containing 5 sub-phases. Currently, the only timing visibility is wall-clock `performance.now()` in the vite-plugin wrapping the entire `analyzeProject()` NAPI call. There is no way to determine which phase consumes time, making optimization decisions speculative.

The vite-plugin already has a `verbose` config option and `ANIMUS_DEBUG=1` env var gating `[animus]`-prefixed log output with 6 `performance.now()` measurement points. The next-plugin has `verbose` but no timing.

Existing phase boundaries in `project_analyzer.rs`:
- Phase 1 (lines 307–383): Parse + walk chains, cache hit/miss
- Phase 2 (lines 399–430): Import resolution + static value maps
- Phase 3 (lines 441–487): Extension provenance resolution
- Phase 4 (lines 490–530): Topological sort
- Phase 5a (line 532): Chain evaluation
- Phase 5b (line 788): JSX scanning
- Phase 5c (line 1192): System prop aggregation
- Phase 5d (line 1240): Usage ledger construction
- Phase 5e (line 1298): Reconciliation
- Phase 6 (lines 1325–1370): Replacements + CSS generation
- Phase 7 (line 1449+): Manifest build + serialization

## Goals / Non-Goals

**Goals:**
- Per-phase timing in Rust crate, returned as structured data across NAPI boundary
- Standardized phase names shared between Rust struct fields and JS display
- Verbose-mode waterfall display in both vite-plugin and next-plugin
- File count and cache-hit stats alongside timing (context for the numbers)
- Always-on collection (Instant::now is ~25ns, negligible overhead)

**Non-Goals:**
- Per-file timing breakdown (useful but separate concern — adds complexity to the hot loop)
- Flamegraph or tracing integration (future work, requires `tracing` crate)
- Changing any extraction behavior — pure observability addition
- Timing the subprocess/system-load step (already measured in vite-plugin JS)

## Decisions

### 1. Timing struct lives in `project_analyzer.rs`, serialized into `UniverseManifest`

`PipelineTiming` is a `#[derive(Serialize)]` struct with one `u64` field per phase (milliseconds). It is added as a field on `UniverseManifest`, which already serializes to JSON across the NAPI boundary. The JS side reads `manifest.timing` — no new NAPI function needed.

**Why not a separate NAPI return value?** `analyze_project` returns a JSON string. Adding a field to the existing JSON is zero-cost on the interface. A separate return would require changing the NAPI signature.

**Why u64 milliseconds, not f64 or microseconds?** Milliseconds are the natural unit for build tooling (matches `performance.now()` on the JS side). u64 avoids floating-point display noise. Sub-millisecond phases round to 0, which is correct — they're not worth optimizing.

### 2. Phase names use snake_case in Rust, camelCase in JS display

Rust struct fields: `parse_and_walk`, `import_resolution`, `extension_provenance`, `topological_sort`, `chain_evaluation`, `jsx_scanning`, `system_prop_aggregation`, `usage_ledger`, `reconciliation`, `css_generation`, `manifest_serialization`.

JS display maps these to human-readable labels. serde renames to camelCase automatically with `#[serde(rename_all = "camelCase")]`.

### 3. Metadata alongside timing: file count + cache stats

`PipelineTiming` also carries `file_count: usize` and `cache_hits: usize`. These contextualize the numbers — 50ms for 10 files is different from 50ms for 500 files. Available from Phase 1's cache check logic.

### 4. Vite-plugin waterfall format

Verbose output after extraction replaces the single-line summary with a phase waterfall:

```
[animus] Extracted 42/48 components (127ms)
         parse+walk     38ms  (245 files, 12 cached)
         imports        11ms
         provenance      2ms
         topo-sort       0ms
         chains         31ms
         jsx-scan       28ms
         sys-props       4ms
         usage           3ms
         reconcile       6ms
         css-gen         3ms
         serialize       1ms
```

The first line remains unchanged for backward compatibility with any tooling parsing verbose output. The waterfall follows as indented detail lines.

### 5. Next-plugin gets identical waterfall

Same format, same field reads. The next-plugin's `loadSystem()` path already has the manifest — just needs the display code.

## Risks / Trade-offs

- **[Timing overhead in hot path]** → `Instant::now()` is 25ns on modern hardware. 11 measurement points = ~275ns per `analyze_project` call. Negligible against the ~100ms+ typical extraction time.
- **[Manifest JSON size increase]** → ~200 bytes for the timing object. Negligible against the typical ~50KB+ manifest.
- **[Phase boundary drift]** → If phases are refactored, timing insertion points need updating. Mitigated by placing timing at clearly-labeled section comments.
