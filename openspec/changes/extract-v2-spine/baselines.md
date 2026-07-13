# Baselines — increment 01 (2026-07-12)

Measurement environment: darwin arm64, bun 1.3.11, release NAPI binary
(`vp run build:extract`), fresh processes per run.

## Determinism (G8 manual form — the red→green arming evidence)

| Path                                              | Pre-patch                                                                                                                           | Post-patch                                    |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `extract()` over 16 tests/fixtures `.tsx`         | **NONDETERMINISTIC** — compound `conditions` key order varied across fresh processes (evidence: `tools/evidence-prepatch-diff.txt`) | DETERMINISTIC ×2 runs (25,896 bytes compared) |
| `analyzeProject` + `transformFile`, devMode=false | not measured pre-patch                                                                                                              | DETERMINISTIC (20,369-byte surface)           |
| `analyzeProject` + `transformFile`, devMode=true  | not measured pre-patch                                                                                                              | DETERMINISTIC (25,465-byte surface)           |

Comparison surface: emitted CSS + transformed code (+ per-file
`hasComponents`). Raw manifest bytes are excluded by design (design.md D2):
internal `HashMap` fields and the `timing` block remain key-order/value
unstable; manifest _size_ is stable across runs (see below).

Commands: `tools/determinism-check.sh` (extract path),
`tools/analyze-run.ts` double-run (project path).

## Performance / size (panel-requested honest numbers)

| Metric                           | devMode=false | devMode=true |
| -------------------------------- | ------------- | ------------ |
| Fixture count                    | 16            | 16           |
| `analyzeProject` wall time       | 1.9–7.4 ms    | 2.0–2.5 ms   |
| `transformFile` total (16 files) | ~1.4 ms       | ~1.5 ms      |
| Manifest size                    | 36,965 B      | 53,736 B     |

Interpretation: at current corpus scale the v1 pipeline is single-digit
milliseconds end-to-end; the rewrite's case is correctness/architecture
(design.md D1 rationale), not present-day wall-clock pain. Scope caveat
(review finding): these are FIXTURE-scale numbers (16 files); D1's
measurement obligation names real scale (n≈55, showcase). Showcase-scale
wall time and empirical parse counts are owed by the harness (increment 02) and are the load-bearing D1 evidence.

## Showcase-scale (increment 02 — the load-bearing D1 measurement)

Command: loadSystemModule(`packages/showcase/src/ds.ts`) + analyzeProject
over all showcase+test-ds sources, then transformFile per file (fresh
process, release binary, 2026-07-12):

| Metric                                                         | Value                           |
| -------------------------------------------------------------- | ------------------------------- |
| Files                                                          | 62 (showcase/src + test-ds/src) |
| Components                                                     | 197                             |
| `analyzeProject` wall time                                     | 14.5 ms                         |
| `transformFile` × 62 (each re-deserializing the full manifest) | 32.9 ms total (~0.5 ms/file)    |
| Manifest size                                                  | 518.1 KB                        |
| Emitted CSS                                                    | 140.1 KB                        |

**D1 verdict, measured:** the entire v1 pipeline is ~50 ms at real scale.
The O(files × manifest) boundary cost is real (62 × 518 KB ≈ 32 MB of JSON
deserialization per transform pass) but costs ~33 ms today. The rewrite's
case rests on correctness/maintainability — the perf leg is officially
retired as motivation (heretic stance, inc-01 review, confirmed by
measurement). Empirical parse counts still pending the v1 counter
(registry row 10).

## Parse counts

Analytic (instrumentation would require edits outside this increment's
footprint — jsx_scanner/system_loader parse sites): per the audit formula,
a k-stage chain file costs k+3 parses on the `extract()` path; the
`analyzeProject` path parses once in Phase 1 plus per-stage/per-file
re-parses in Phases 5/5b. Empirical per-fixture parse counters land with the
harness (`extraction-parity-harness` §Parse-count reporting, increment 02)
— recorded as the automated equivalent for this deferral.

## Empirical parse counts (row 10 — the v1 counter)

`timing.parseCount` (analyze path; camelCase in manifest JSON):

| Corpus | Files | v1 parses | Ratio | v2 parses (chain-parity oracle) |
|---|---|---|---|---|
| button.tsx alone | 1 | 7 | 7.0× | 1 |
| extract fixtures combined | 16 | 119 | 7.4× | 16 |
| showcase + test-ds (real scale) | 62 | 496 | **8.0×** | 62 |

The audit's analytic k+3 claim is retired in favor of these measured
numbers: v1 parses each file ~8× at real scale (Phase-1 parse + per-stage
argument re-parses + compose pre-scan + JSX scan + transform-callback
strips). v2's parse-once budget (G1) holds at exactly 1× by construction.
Note: at ~0.3 ms/parse this remains a correctness/architecture argument,
not a wall-clock one (D1 stands as amended).
