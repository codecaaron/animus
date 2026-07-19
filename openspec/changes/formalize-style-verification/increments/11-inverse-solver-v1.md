# Increment 11: inverse-solver-v1

## Scope

- **Registry row**: 11 · mode: inline · review: subagent-if-available
- **Resolves**: — (implements enveloped `specs/inverse-style-solver/spec.md`;
  DEF-5 — CSP/SMT escalation — stays deferred and is NOT this row)
- **Authors**: — (envelope)
- **Depends on (deps:)**: 03
- **Inputs from (inputs:)**: none
- **Footprint**: `packages/_verify/src/solver/**`

## Context Capsule

Read first: `specs/inverse-style-solver/spec.md` (ranked in-universe
solving; universe-extension proposals); `design.md` §Goals (solver ranking
is the product) and the Ledger row DEF-5 (escalation trigger — this
increment produces the measurement that resolves or retires it).

Repo facts:
- Reverse indexes come from the `SessionIndex`: declaration → producing
  (component, layer, variant option | state | prop-value) via
  `component_fragments` + `system_prop_map`; scale value → scale key via
  the serialized theme. Solve = index lookup + conjunction over the goal's
  required declarations; rank by edit distance from current workspace state
  (fewest patch operations, ties broken by cascade-tier locality).
- Every returned candidate carries a `VerdictEnvelope` produced by replay
  (reuse `queries.ts` — no parallel prediction path).
- Extension proposals: when a required value misses every scale/enum, emit
  a labeled proposal (`kind: 'universe-extension'`, naming scale + value)
  distinct from solutions (spec scenario "Off-scale target value").
- Measurement obligation (feeds DEF-5): record solve rate over the fixture
  goal corpus (solved-in-universe / total) in the increment's journal entry.

## Plan

- [ ] 1. Failing test: a goal satisfiable by two configurations returns both, lowest-edit-distance first, each with a verdict-bearing answer.
- [ ] 2. Implement `solver/indexes.ts` + `solver/solve.ts`. PASS.
- [ ] 3. Failing test: an unsatisfiable goal reports unsatisfiability over the enumerated region — no near-miss presented as satisfying.
- [ ] 4. Implement honest unsatisfiability. PASS.
- [ ] 5. Failing test: an off-scale spacing target yields a labeled extension proposal naming scale and value, excluded from solutions.
- [ ] 6. Implement `solver/extensions.ts`. PASS.
- [ ] 7. Measure solve rate over a ≥10-goal fixture corpus; record the number for the journal (DEF-5 evidence).
- [ ] 8. Checkpoint: `vp run verify:compile && bunx vp test run packages/_verify/__tests__/`; expected: PASS.

## Guardrail gate

Active package guardrails run in the suite; no new rows arm here.

## Spec authorship checklist

- [x] — (envelope)
