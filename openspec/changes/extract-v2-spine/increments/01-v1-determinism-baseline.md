# Increment 01: v1-determinism-baseline

## Scope

- **Registry row**: 01 · mode: inline · review: subagent
- **Resolves**: D10 (implements the sanctioned v1 determinism patch;
  records fixture-scale baselines — real-scale measurement and empirical
  parse counts remain owed by the harness, per D1)
- **Authors**: — (envelope; `deterministic-extraction` requirements already
  cover this row)
- **Depends on (ordering — deps:)**: none
- **Inputs from (information — inputs:)**: none
- **Footprint**: packages/extract/src/transform_emitter.rs,
  packages/extract/src/lib.rs, packages/extract/tests/**,
  openspec/changes/extract-v2-spine/** (evidence, baselines, and runner
  tooling — footprint amended at the 01 reorientation; the original
  declaration omitted the change-directory artifacts its own Objective
  required)
- **Pushes to a later increment**: none

> Envelope-licensed at propose time (journal seed entry, 2026-07-12) — no
> resolving signal needed; this row was created with the envelope.

## Context Capsule

- **Objective**: v1's emitted artifacts (CSS + transformed code) are proven
  byte-deterministic across repeated fresh-process runs over every existing
  fixture and both `dev_mode` values, after a minimal serialization patch;
  baseline measurements (per-fixture build time, manifest size, parse
  counts) are recorded into this change directory so later perf claims are
  measured, not asserted.
- **In-scope guardrails** (from design.md Guardrail Register):
  - G8: baselines SHALL NOT be recorded while the self-check is red —
    check (manual form until the harness exists): run each extraction twice
    in fresh processes, byte-diff emitted CSS and transformed code —
    expected FAIL before the patch (HashMap-ordered emitted fields),
    empty diff after — STOP
  - G3 positive control (context only; the ban targets v2):
    `rg -n 'replace_range|\[\.\..*len\(\)' packages/extract/src/` —
    expected ≥4 hits; this increment must not change that count except
    where the determinism patch touches those exact lines — WARN
- **Existing behavior constraints**: this is v1 — the ONLY sanctioned change
  is deterministic serialization ordering of emitted fields. No other v1
  behavior may change (design.md Non-Goals). All existing tests
  (`vp run verify:unit:rust`, `verify:canary`, `verify:integration`) must
  stay green.
- **Where the nondeterminism lives** (locate by symbol, not line):
  - Compound-variant conditions: collected into a std `HashMap` in
    `lib.rs` (search `compound` / `conditions` in `process_chain`
    surroundings) and serialized via `json!` in
    `transform_emitter.rs::generate_replacement`/`build_runtime_config`.
  - `customPropMap`: `HashMap<String, HashMap<String, String>>` serialized
    directly in `transform_emitter.rs` (search `customPropMap`).
  - `customDynamicConfig`: same pattern (search `customDynamicConfig`).
  - Manifest-internal nondeterminism (std HashMap fields + `timing` in
    `project_analyzer.rs::UniverseManifest`) is OUT of the byte surface by
    design (design.md D2) — do not patch it; document it in the baseline
    notes instead.
- **Relevant resolved decisions (constraints)**: D2 (comparison surface =
  raw NAPI outputs: emitted CSS bytes + transformed code), D10 (sorting
  patch is sanctioned; field exclusion is not).
- **Upstream inputs**: none.
- **In-scope North Star criteria**: NS6 (determinism), NS5 (invisible until
  flipped — the patch must not change any semantically-visible output
  beyond key order).
- **Prohibitions**: no version-control commands; no writes outside the
  declared footprint plus this increment file; never write to design.md,
  tasks.md, journal.md, or specs/.

## Plan

## Task 01.1: Determinism patch

- [x] **Step 1:** Compound-condition serialization key-sorted — implemented
      at the serialization site in `transform_emitter.rs` (`BTreeMap` collect
      inside the compounds `json!` block) rather than retyping the producer in
      `lib.rs`; equivalent effect, smaller blast radius. Tests green.
- [x] **Step 2:** Same treatment for `customPropMap` (both nesting levels)
      and `customDynamicConfig.scaleValues` (top-level cdc keys were already
      sorted in v1).
- [x] **Step 3:** Unit test
      `emission_is_key_sorted_for_hashmap_backed_fields` added — asserts exact
      sorted key order (run-twice equality would trivially pass in-process).
      280 Rust tests pass.

## Task 01.2: Self-determinism proof

- [x] **Step 4:** `tools/determinism-run.ts` (extract path) +
      `tools/analyze-run.ts` (analyzeProject + transformFile path) double-run
      in fresh processes over all 16 tests/fixtures `.tsx`, both `dev_mode`
      values: zero diffs post-patch.
- [~] **Step 4a (deferred portion):** `packages/_integration/fixtures/`
  components were exercised via `verify:integration` (green) but not
  double-run; automated equivalent: harness self-check identity mode
  (increment 02, `extraction-parity-harness` §Self-check mode).
- [x] **Step 5:** Pre-patch red evidence captured WITHOUT VCS operations
      (check ran against the unpatched build first):
      `tools/evidence-prepatch-diff.txt` — compound `conditions` key order
      differs across fresh processes, exactly the defect class the check bans.

## Task 01.3: Baselines

- [x] **Step 6:** `baselines.md` written: determinism table (red→green),
      wall-time (1.9–7.4 ms analyze, ~1.5 ms transform, 16 files), manifest
      sizes (36,965 B prod / 53,736 B dev). Parse counts recorded analytically;
      empirical counters deferred to the harness parse-count mode (outside this
      increment's footprint — jsx_scanner/system_loader parse sites).

## Guardrail gate

- [x] G8 (manual form): double-run byte-diff — result: **TRIP pre-patch**
      (by design — arming evidence, `tools/evidence-prepatch-diff.txt`), then
      **pass** post-patch ×2 consecutive checks (extract path) + pass both
      dev modes (project path).
- [x] G3 control: `rg -c 'replace_range|\[\.\..*len\(\)' packages/extract/src/`
      — result: 10 hits (unchanged from calibration; patch introduced no new
      string surgery).
- [x] Change-Type Map tiers: `verify:unit:rust` 280 passed ·
      `verify:canary` 197 passed, 4 snapshots, 0 fail · `verify:integration`
      exited 0.

## Output contract (inline mode — collapse into checklists above)

- [x] Plan checkboxes ticked to reflect actual completion
- [x] Guardrail gate results recorded with output excerpts
- [x] Proposed journal entries: recorded directly (inline mode) — see
      journal 2026-07-12 20:38 / 20:40 / 20:41
- [x] Surfaced variables: manifest-consumer determinism leak (RF-4) →
      spawned row 09; comparison-surface altitude (RF-10) → increment 02
      Act item

## Spec authorship checklist (orchestrator; tie-back before ticking)

- [ ] No new spec text owed (authors: —); confirm envelope
      `deterministic-extraction` scenarios are exercised by the new tests
- [ ] Journal entries appended; reorientation entry written
- [ ] Registry row 01 ticked with `· ticked: <reorientation timestamp>`
