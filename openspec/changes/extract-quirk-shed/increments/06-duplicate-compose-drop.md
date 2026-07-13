# Increment 06: duplicate-compose-drop

## Scope

- **Registry row**: 06 · mode: inline · review: self
- **Resolves**: —
- **Authors**: —
- **Depends on (deps:)**: none
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

- [ ] **Step 1:** Remove the `parity/duplicate-compose.tsx` entry from
  `packages/_parity/register.json`; run
  `bash scripts/verify/parity.sh | tail -1`.
- [ ] **Step 2:** If PASS → drop stands (v1 vs v2 no longer diverge on
  the unit, or the unit left the compared set). If FAIL (unregistered
  divergence) → restore the entry, set note to "shed complete
  2026-07-13 (inc 06): v2 correct by construction; entry drops at
  oracle inversion (row 07) when v1 leaves the oracle set", keep
  status active.
- [ ] **Step 3:** Record which branch was taken.

## Guardrail gate

- [ ] G2 — result: <record>
- [ ] G3 — result: <record>
- [ ] G4 — result: <record>

## Output contract (inline — collapsed)

- [ ] Checkboxes ticked; branch taken recorded; gate results recorded

## Spec authorship checklist (orchestrator)

- [ ] Journal + tick row 06 `· ticked: <ts>`
