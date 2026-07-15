# Increment 02: eval-drop-diagnostic

## Scope

- **Registry row**: 02 · mode: inline (delegated — journal mode-change
  2026-07-13 03:25) · review: self
- **Resolves**: —
- **Authors**: §extraction-diagnostics/Eval-failed chains are diagnosed
  — authored at propose (envelope).
- **Depends on (deps:)**: increment 01
- **Inputs from (inputs:)**: none
- **Footprint**: packages/extract/crates/extract-v2/src/**,
  packages/_parity/register.json, openspec/changes/extract-quirk-shed/**
- **Pushes to a later increment**: none

## Context Capsule

- **Objective**: A builder chain dropped because stage evaluation
  failed emits a bail diagnostic naming file, binding, and failing
  stage — it no longer vanishes silently from the manifest. The source
  file stays untransformed for that chain (existing behavior; only the
  diagnostic is new).
- **In-scope guardrails** (STOP): G2 (compare.ts/scoreboard.ts
  untouched), G3 (`PARITY GATE: PASS`, 0 unregistered), G4 (v1
  present) — same commands as increment 01.
- **Requirement being implemented** (verbatim): "A builder chain
  dropped because stage evaluation failed SHALL emit a bail diagnostic
  naming the file, binding, and failing stage; silent disappearance
  from the manifest SHALL NOT occur." Scenario: `.props()` argument
  evaluates statically but fails config deserialization → manifest
  diagnostics contain a bail entry for that binding; file left
  untransformed for that chain.
- **Known witnesses**: journal evidence (spine, 2026-07-13 08:45): v1
  `project_analyzer.rs` lines ~967-969 have an EMPTY `Err` arm; v2
  mirrors it in `analyze_css.rs`. Corpus unit
  `packages/_parity/corpus/props-serde-reject.tsx` exists and exercises
  the serde-reject path.
- **Relevant resolved decisions**: D1 (license via register entry if
  the manifest/diagnostics artifact now diverges from v1 on any corpus
  unit); D3 (no v1 backport — plugins tolerate absent diagnostics; v1
  is oracle-only).
- **In-scope North Star**: NS1 (silent→loud), NS2, NS3.
- **Prohibitions**: as increment 01 (no VCS, footprint-only, no
  design/tasks/journal/specs writes, no _parity/src edits, no v1 edits).

## Plan

## Task 02.1: implement the bail diagnostic

- [x] **Step 1:** Locate the mirrored empty Err arm:
  `rg -n 'Err' packages/extract/crates/extract-v2/src/analyze_css.rs`
  (cross-check against v1 `rg -n '' packages/extract/src/project_analyzer.rs`
  around lines 960-975 for the mirrored shape). Find where a failed
  chain evaluation is discarded.
  (Found TWO mirrors of v1 967-969 in analyze_css.rs `run()`: the
  `chain.fatal_error` gate — facts-time stage eval errors, chain-fatal
  via v1's `?` — and the `Err(_e)` arm on `process_chain_facts` — the
  post-facts path, e.g. props serde reject. Both discarded silently.)
- [x] **Step 2:** Emit a bail diagnostic (reuse the diagnostic channel
  found in increment 01) carrying: source file path, binding name,
  failing stage identifier.
  (`emit_eval_drop_bail` helper pushes a `CssDiagnostic` kind "bail",
  binding in `component`, stage + detail in `message` — wired at BOTH
  silent-skip sites; `process_chain_facts` error now carries
  `(failing stage method, detail)`. Crate tests cover both legs.)
- [x] **Step 3:** `cargo test --lib` in the crate — green (281 passed,
  0 failed, incl. the two new bail-diagnostic tests). Rebuilt v2 binary
  (`bunx napi build --platform --release`, 28.6s).

## Task 02.2: license + gates

- [x] **Step 1:** Run `bash scripts/verify/parity.sh | tail -1`. If the
  new diagnostic makes any compared artifact diverge on a corpus unit
  (expect `props-serde-reject.tsx`), add a register entry
  (category intentional-correctness, status active) describing the
  bail-diagnostic divergence; re-run → `PARITY GATE: PASS`.
  (Diverged, diagnostics artifact only, both dev modes:
  `parity/props-serde-reject.tsx` (0 vs 1) and
  `extract/per-property-bail.tsx` (1 vs 2 — SpreadComponent's spread
  is chain-fatal). Licensed both with new intentional-correctness
  entries (shed 2026-07-13, extract-quirk-shed inc 02) and appended
  the inc-02 bail to the already-licensed `extract-all · diagnostics`
  note (its aggregate went 1 vs 4). Re-run → `PARITY GATE: PASS`,
  0 unregistered in both modes.)
- [x] **Step 2:** G2 + G4 checks — pass.

## Guardrail gate

- [x] G2 — result: PASS —
  `git status --short packages/_parity/src/compare.ts packages/_parity/src/scoreboard.ts`
  → empty output (2026-07-13)
- [x] G3 — result: PASS — final line of `bash scripts/verify/parity.sh`
  is `PARITY GATE: PASS`; v1-vs-v2 legs report
  `Divergences: 21 (0 unregistered)` (devMode false) and
  `Divergences: 25 (0 unregistered)` (devMode true)
- [x] G4 — result: PASS —
  `test -f packages/extract/index.js && test -f packages/extract/src/lib.rs`
  → exit 0

## Output contract (delegated)

- [x] Plan checkboxes ticked
- [x] Diff summary; exact bail-diagnostic shape (JSON)
- [x] Gate results with excerpts
- [x] Proposed journal entries — or none
- [x] Surfaced variables — or none

## Spec authorship checklist (orchestrator)

- [x] Envelope spec covers row; diagnostic shape matches scenario
- [x] Journal + tick row 02 `· ticked: 2026-07-13 04:05`
