# Increment 05: universe-diff-governance

## Scope

- **Registry row**: 05 · mode: inline · review: subagent
- **Resolves**: — (implements enveloped `specs/semantic-universe-diff/spec.md`)
- **Authors**: — (envelope)
- **Depends on (deps:)**: 03
- **Inputs from (inputs:)**: none
- **Footprint**: `packages/_verify/src/diff/**`

## Context Capsule

Read first: `specs/semantic-universe-diff/spec.md` (four requirements:
normalized diffing, bounded equivalence, governance artifact, invisible-edit
alarm); `design.md` §G6 and the Goodhart discussion under Risks.

Repo facts:
- Inputs are two `SessionIndex`-parsed manifests of the same mode/schema
  (mode stamps from increment 03; refuse mismatches).
- Normalization precedent: `packages/_parity/src/compare.ts` and
  `packages/_parity/src/types.ts` (`UnitSurface`, artifact classes,
  divergence classification) — reuse the comparison vocabulary, do not
  reinvent it.
- Diff dimensions (spec): components added/removed; per-component,
  per-layer declaration changes (join `component_fragments`); residue
  deltas (`usageResidue`); drop-outcome deltas (diagnostics); provenance
  edge changes (`extends_from` / `reverse_provenance`).
- Invisible-edit alarm: an edit's touched files come from the caller (list
  of changed paths); "style-bearing" detection = changed spans intersect
  chain spans (`fileFacts` stage spans) or callsite/spread records
  (increment-02 fields). Alarm fires when style-bearing touches exist and
  the universe diff is empty.
- Governance artifact: a markdown renderer over the diff + verdicts,
  deterministic output (stable ordering — sort keys, no timestamps).

## Plan

- [ ] 1. Failing test: diff of two analyses of the unchanged fixture workspace is empty; diff after adding a variant option to a fixture copy lists exactly that option with its declarations.
- [ ] 2. Implement `diff/universeDiff.ts`. PASS.
- [ ] 3. Failing test `__tests__/equivalence-schema.test.ts` (G6's named check): an equivalence result without non-empty `contract` and `coveredRegion` fields is rejected by the result constructor; a real refactor-equivalence over the fixture universe carries both plus a `holes` exclusion list.
- [ ] 4. Implement `diff/equivalence.ts`. PASS.
- [ ] 5. Failing test: fixture edit moving a static prop into a spread object → empty universe diff + style-bearing touch ⇒ alarm result naming the touched site (never a clean report).
- [ ] 6. Implement `diff/invisibleEdit.ts`. PASS.
- [ ] 7. Failing test: markdown renderer output for the variant-add diff is byte-stable across two runs and names component, change, provenance, and verdict.
- [ ] 8. Implement `diff/renderGovernance.ts`. PASS.
- [ ] 9. Checkpoint: `vp run verify:compile && bunx vp test run packages/_verify/__tests__/`; expected: PASS. G6 flips to `active`.

## Guardrail gate

Arms G6 (its named test lands in step 3). G1/G2 remain active in the suite.

## Spec authorship checklist

- [x] — (envelope)
