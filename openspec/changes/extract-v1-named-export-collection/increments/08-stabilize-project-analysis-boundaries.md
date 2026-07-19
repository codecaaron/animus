# Increment 08: stabilize V1 project-analysis boundaries

**Goal:** Reduce verified `project_analyzer.rs` coordination and duplication
without changing NAPI, manifest, cache, or serialized-output behavior.

## Implemented value

- [x] Replaced the fourteen-argument internal `analyze()` call with one typed
  `AnalyzeInput`; the positional NAPI boundary remains unchanged.
- [x] Built component props, usage configs, and custom props in one private pass
  over sorted evaluated components instead of three adjacent walks.
- [x] Preserved cache-hit clone and cache-miss remove semantics while feeding
  one shared `CachedFileResult` insertion.
- [x] Extracted Phase 5d usage-ledger enrichment and Phase 5e reconciliation
  behind private owners while keeping timing and phase order in `analyze()`.
- [x] Extracted Phase 1 cache-aware parallel parsing, Phase 3 extension
  provenance, and Phase 4 deterministic ordering behind private owners while
  preserving cache take/merge semantics and cycle/unresolved-parent fallback.
- [x] Extracted Phase 5a chain evaluation behind one typed owner and split
  parent CSS/runtime-config merging and active-prop inheritance into private
  policy helpers without moving timing or topological order.
- [x] Extracted Phase 5b behind typed JSX-scan and utility-output owners while
  preserving compose-before-JSX resolution, cache-hit reuse, imported aliases,
  dynamic/custom metadata, and downstream cache ownership.
- [x] Extracted Phase 5c runtime metadata and Phase 6 replacement/CSS output
  behind typed owners while preserving the intervening usage/reconciliation
  order, compose/global/keyframe assembly, and compatibility CSS behavior.
- [x] Extracted Phase 7 manifest-data construction and cache persistence behind
  phase owners while preserving compose-before-drain order, cache hit/miss
  ownership, common insertion, eviction, diagnostics, and timing.
- [x] Extracted Phase 2 import/static resolution plus invalid-transform
  diagnostics and direct-parent reverse provenance as one final coordinator
  bundle while preserving precedence, enrichment, ordering, and timers.

## Evidence

- RepoWise identified `project_analyzer.rs` as a hotspot with a 1,198-NLOC,
  CCN-217 `analyze()` coordinator and fourteen parameters. Its index was one
  commit stale, so live source governed the edit.
- Direct project-analyzer units: 11/11. The Phase 2 matrix drives the real
  `resolve_project_imports()` owner with conflicting resolution targets and
  colliding enrichment values, proving relative → alias → package precedence
  plus local → imported static → imported keyframe → same-file keyframe order.
- Strict Clippy: pass.
- Rust units: 643 passed, 1 ignored, 0 failed (`286 + 9 + 348`).
- Canary: the expected stale-binary diagnostic requested exactly
  `vp run build:extract`; that single build passed, then canary passed 200/200
  with 4 snapshots and 432 expectations.
- Integration: 157/157 across 11 files.
- `git diff --check`: empty. Pre-existing whole-file Rustfmt drift was not
  normalized or added to this bundle.
- `analyze()` is 363 lines versus 1,560 at `HEAD`, a 1,197-line coordinator
  reduction; each new phase helper has exactly one definition and one call.
- Each accumulated source bundle used that same mapped owner chain. The final
  rerun after the strengthened Phase 2 guard retained the exact result above;
  independent review raised two test-strength findings, both were corrected,
  and the required clean re-review followed.

## Completion

- **Status:** complete; D12–D21 and G15 are satisfied.
- **Review cadence:** source value and mapped verification preceded cockpit
  writes. Reviews occurred only at accumulated risk boundaries; the final
  review/fix/re-review cycle is summarized once in Evidence.
- **Residuals:** `analyze()` remains the highest-value V1 coordinator hotspot;
  later work requires a concrete behavioral, deletion, performance, or coverage
  payoff. A complexity score alone is not an activation signal.
