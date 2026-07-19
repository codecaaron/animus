# Increment 06: witness-envelope

## Scope

- **Registry row**: 06 · mode: delegate · review: subagent
- **Resolves**: — (implements the `specs/style-witness-recording/spec.md`
  delta §Witness comparison envelope)
- **Authors**: — (envelope)
- **Depends on (deps:)**: none
- **Inputs from (inputs:)**: none
- **Footprint**: `packages/system/src/runtime/**`

## Context Capsule

Read first: the delta spec above; the existing base spec
`openspec/specs/style-witness-recording/spec.md`; `design.md` §G5.

Repo facts:
- The witness lives at `packages/system/src/runtime/witness.ts`: a dev-only
  ring buffer at `globalThis.__ANIMUS_WITNESS__` of
  `{component, prop, value, outcome}` records, capacity `WITNESS_CAP`
  (5000), stripped in production via the `NODE_ENV` guard at the top of
  `recordWitness`. Preserve that guard pattern exactly — production builds
  must retain none of this.
- This increment adds the envelope only: a sibling global
  (`globalThis.__ANIMUS_WITNESS_ENVELOPE__`) set once via a new exported
  `setWitnessEnvelope({ manifestDigest, buildId, mode, epoch })`, readable
  alongside the records. Wiring the *values* (which digest, which epoch)
  is plugin work outside this footprint — the runtime only provides the
  slot and the dev-only setter.
- Comparison-refusal behavior ("mismatched envelope ⇒ `unknown`") is
  consumer-side (`packages/_verify`, guardrail G5's test) — NOT this
  increment. Do not add comparison logic to the runtime.
- Verification for this footprint (Change-Type Map):
  `vp run verify:compile && vp run verify:types && vp run verify:unit:ts`.

## Plan

- [ ] 1. Failing test beside the existing witness tests (locate via `rg -l "__ANIMUS_WITNESS__" packages/system`): `setWitnessEnvelope` stores the four fields readable at the documented global; calling it in a simulated production env stores nothing.
- [ ] 2. Run the system unit suite; expected: FAIL (export missing).
- [ ] 3. Implement the envelope type, global, and dev-gated setter in `witness.ts` (mirror `recordWitness`'s environment guard).
- [ ] 4. Re-run; expected: PASS.
- [ ] 5. Checkpoint: `vp run verify:compile && vp run verify:types && vp run verify:unit:ts`; expected: all PASS.

## Guardrail gate

None active for this footprint (G5 is consumer-side and arms with the
`_verify` triage code). Gate = step 5 commands.

## Spec authorship checklist

- [x] — (envelope)

## Output contract (delegate)

Return: (a) the exported symbol names and envelope type (paste), (b) test
name + PASS tail, (c) confirmation the production-env test proves the
stripped path, (d) any surprise about the global-handle documentation as a
journal candidate. Do not edit spec files.
