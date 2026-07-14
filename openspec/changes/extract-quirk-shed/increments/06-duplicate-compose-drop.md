# Increment 06: duplicate-compose-drop

## Scope

- **Registry row**: 06 · mode: delegate · review: subagent
- **Resolves**: —
- **Authors**: —
- **Depends on (deps:)**: increment 05
- **Inputs from (inputs:)**: none
- **Footprint**: packages/_parity/register.json,
  openspec/changes/extract-quirk-shed/**
- **Pushes to a later increment**: the entry's physical drop belongs to
  row 07 if removing it now creates an unregistered divergence (v1 is
  still the live oracle until then).

## Context Capsule

- **Objective**: The `parity/duplicate-compose.tsx`
  intentional-correctness entry (v2 already correct; v1 double-replaces
  the first span with mangled output) is shed with ZERO code change.
  While v1 remains the live oracle the divergence still manifests on
  every differential run, so the entry may only be dropped if the gate
  stays PASS; otherwise it stays active with a shed-complete note and
  drops at oracle inversion (row 07).
- **In-scope guardrails** (STOP): G2, G3, G4 — commands as increment 01.
- **Relevant resolved decisions**: D1 (the register is the license —
  never leave the divergence unlicensed).
- **Prohibitions**: register.json is the ONLY code-side file this row
  may touch.

## Plan

## Task 06.1: attempt the drop, evidence-driven

- [x] **Step 1:** Remove the `parity/duplicate-compose.tsx` entry from
  `packages/_parity/register.json`; run
  `bash scripts/verify/parity.sh | tail -1`.
  (RED: final line was `PARITY GATE: FAIL (baseline scoreboard.snap NOT
  updated; details in last-failure.txt)`. The receipt identified
  `parity/duplicate-compose.tsx · code (UNREGISTERED)` in both modes:
  23 divergences / 1 unregistered in production and 27 / 1 in dev.)
- [x] **Step 2:** If PASS → drop stands (v1 vs v2 no longer diverge on
  the unit, or the unit left the compared set). If FAIL (unregistered
  divergence) → restore the entry, set note to "shed complete
  2026-07-13 (inc 06): v2 correct by construction; entry drops at
  oracle inversion (row 07) when v1 leaves the oracle set", keep
  status active.
  (FAIL branch taken. The entry was restored with the exact note and
  remains `intentional-correctness` / `active`. GREEN: the same parity
  command's final line returned `PARITY GATE: PASS`.)
- [x] **Step 3:** Record which branch was taken.
  (Branch: physical drop deferred to row 07 because live v1 still
  produces the registered code divergence in both compared modes.)

## Guardrail gate

- [x] G2 — result: PASS —
  `git status --short packages/_parity/src/compare.ts packages/_parity/src/scoreboard.ts`
  produced empty output; exit 0.
- [x] G3 — result: PASS — final output of
  `bash scripts/verify/parity.sh | tail -1` was
  `PARITY GATE: PASS`; exit 0 after the active entry was restored.
- [x] G4 — result: PASS —
  `test -f packages/extract/index.js && test -f packages/extract/src/lib.rs`
  produced empty output; exit 0.

## Output contract (delegated)

- [x] Plan checkboxes ticked with exact RED/GREEN evidence
- [x] FAIL/restore branch and final register disposition recorded
- [x] Exact diff summary recorded
- [x] Guardrail gate results recorded with output excerpts
- [x] Proposed journal entries recorded below; not written to journal.md
- [x] Surfaced variables recorded below

### Returned evidence

- **RED/GREEN:** removing the entry made the full differential fail in
  both modes solely because `parity/duplicate-compose.tsx · code` was
  unregistered (23/1 production, 27/1 dev). Restoring the entry made the
  unchanged gate return `PARITY GATE: PASS`.
- **Branch/register disposition:** FAIL/restore. The code-side result is
  the existing active `intentional-correctness` license with its note
  replaced by the required row-07 handoff text: `shed complete
  2026-07-13 (inc 06): v2 correct by construction; entry drops at
  oracle inversion (row 07) when v1 leaves the oracle set`.
- **Exact increment-06 diff:** `packages/_parity/register.json` changes
  only the duplicate-compose entry's note; this packet records the
  branch, receipts, and delegated output contract. Pre-existing row-04
  and row-05 register changes were preserved. The deliberate row-06 RED
  receipt did not replace row 04's pre-existing `last-failure.txt`
  witness in the final tree.
- **Proposed journal · signal:** the live-v1 differential still needs
  the duplicate-compose code license in both production and dev; row 06
  is semantically shed-complete, and its tick makes the DEF-2/DEF-3
  row-07 oracle-inversion/retirement resolving signal available.
- **Surfaced variables:** no new spawn candidate. Existing DEF-2
  (committed-baseline oracle inversion) and DEF-3 (`loadSystemModule`
  disposition at v1 retirement) become actionable at the row-06
  reorientation; row 07 owns the physical license drop.

## Spec authorship checklist (orchestrator)

- [x] Journal + tick row 06 `· ticked: 2026-07-13 17:25`
