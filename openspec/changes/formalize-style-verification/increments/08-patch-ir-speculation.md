# Increment 08: patch-ir-speculation

## Scope

- **Registry row**: 08 · mode: inline · review: subagent-if-available
- **Resolves**: D5 (typed patch IR over constrained generation)
- **Authors**: — (envelope: `specs/style-patch-ir/spec.md`,
  `specs/speculative-edit-selection/spec.md`)
- **Depends on (deps:)**: 03, 05
- **Inputs from (inputs:)**: none
- **Footprint**: `packages/_verify/src/patch/**`, `packages/_verify/src/select/**`

## Context Capsule

Read first: both spec files above; `design.md` §D5, §G4, and the Goodhart
risk row.

Repo facts:
- Patch schemas derive from the `SessionIndex` enumerations: variant options
  and state names (`crossFile`), prop/value keys (`system_prop_map`), scale
  keys (theme serialization). Schema compilation = manifest → JSON Schema
  literal enums, recomputed after every re-analysis (spec scenario "Schemas
  reflect the project").
- Application is span-addressed string splicing against the attribute spans
  from callsite records (increment 02) and chain stage spans (`fileFacts`)
  — assert the pre-image text before replacing (the repo's twice-burned
  lesson: never exact-string-replace without an assertion), splice by byte
  span, verify determinism by double-application to twin fixtures.
- Speculation never touches disk: `ExtractEngine.analyze()` accepts
  in-memory `{path, source}` entries, so candidate evaluation feeds edited
  sources directly (compose with `analyzeWorkspace`'s discovery output).
- Scoring (spec + G4): rank `exact > conditional > divergent >
  unverifiable`; preserve violations disqualify outright.

## Plan

- [ ] 1. Failing test: compiling patch schemas from the fixture manifest yields a variant enum matching the fixture's declared options; a patch setting an out-of-enum value is rejected naming the legal options, before any application.
- [ ] 2. Implement `patch/schema.ts` + `patch/validate.ts`. PASS.
- [ ] 3. Failing test: applying a validated `set-prop` patch to twin fixture copies produces byte-identical files; a stale span (pre-image mismatch) aborts with no write.
- [ ] 4. Implement `patch/apply.ts` (span splice + pre-image assertion). PASS.
- [ ] 5. Failing test: post-application verification of a schema-valid-but-wrong patch returns `divergent`, not `exact` (spec scenario).
- [ ] 6. Wire apply → re-analyze → goal evaluation. PASS.
- [ ] 7. Failing test `__tests__/scoring-order.property.test.ts` (G4's named check): property test over generated candidate sets asserting the verdict ranking and that no `unverifiable` candidate ever ranks ≥ a `divergent` one.
- [ ] 8. Implement `select/score.ts` + `select/speculate.ts` (N candidates, in-memory analyses, disk untouched — assert fixture mtimes/contents unchanged; at most one commit). PASS.
- [ ] 9. Checkpoint: `vp run verify:compile && bunx vp test run packages/_verify/__tests__/`; expected: PASS. G4 flips to `active`.

## Guardrail gate

Arms G4 (step 7). G1/G2/G6 remain active in the suite.

## Spec authorship checklist

- [x] — (envelope)
