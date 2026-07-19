# Increment 01: verdict-contract

## Scope

- **Registry row**: 01 · mode: inline · review: subagent-if-available
- **Resolves**: D1 (four-valued verdict taxonomy); implements the schema side of D9, D10, D11
- **Authors**: — (envelope: `specs/style-verdict-contract/spec.md` covers this row)
- **Depends on (deps:)**: none
- **Inputs from (inputs:)**: none
- **Footprint**: `packages/_verify/src/contract/**`

## Context Capsule

Read first: `openspec/changes/formalize-style-verification/specs/style-verdict-contract/spec.md`
(the behavioral contract this increment implements) and `design.md` §D1, §D10,
§D11, §NS1–NS2.

Repo facts a cold agent needs:
- New private workspace package `packages/_verify` (D11). Model its
  `package.json`/`tsconfig.json` on `packages/_parity/` (private, no publish,
  `compile: tsgo --noEmit`). Register by adding nothing — bun workspaces pick
  up `packages/*`; run `bun install` after scaffolding.
- No new runtime dependencies: types + hand-written validators, no zod.
- Test runner: `bunx vp test run packages/_verify/__tests__/` (Vitest).
- Type check: `vp run verify:compile` (tsgo across all packages).

Deliverable shape (`packages/_verify/src/contract/`):
- `types.ts` — `Verdict = 'exact' | 'divergent' | 'conditional' | 'unverifiable'`;
  `StyleGoal { component; environment: { mode: 'production' | 'development';
  breakpoint?: string; states?: string[]; theme?: string }; require:
  Record<string, string>; preserve?: { noNewDrops?: boolean; noNewResidue?:
  boolean } }`; `VerdictEnvelope { verdict; evidence: { facts: unknown[];
  declarations: { property: string; value: string; provenance?: unknown }[] };
  environment: { mode; engineIdentity: string; schemaVersion: string };
  assumptions: string[]; runtimeConfirmationRequired: boolean;
  blindingSites?: { file: string; span: [number, number] }[] }`.
- `version.ts` — `CONTRACT_SCHEMA_VERSION` (semver string, start `1.0.0`).
- `validate.ts` — `validateGoal(x): StyleGoal | ContractError`,
  `validateEnvelope(x)`, and `detectVersionMismatch(x): boolean` that reads
  only the version field (spec scenario "Consumer behind the contract").

## Plan

- [ ] 1. Scaffold `packages/_verify/` (`package.json` name `@animus-ui/verify-internal`, private; `tsconfig.json`; empty `src/contract/`); run `bun install`; expected: workspace resolves.
- [ ] 2. Write failing tests `packages/_verify/__tests__/contract.test.ts`: verdict set is exactly the four values; a goal missing `component` fails validation with a named error; an envelope without `runtimeConfirmationRequired` fails; `detectVersionMismatch({schemaVersion: '999.0.0'})` returns true without touching other fields (feed it an otherwise-corrupt object).
- [ ] 3. Run `bunx vp test run packages/_verify/__tests__/contract.test.ts`; expected: FAIL (module not found).
- [ ] 4. Implement `types.ts`, `version.ts`, `validate.ts` to the capsule shapes; minimal code to pass.
- [ ] 5. Run the test file again; expected: PASS.
- [ ] 6. Checkpoint: `vp run verify:compile && vp run verify:lint`; expected: both PASS.

## Guardrail gate

No register rows are active for this footprint yet (G1/G2 arm at increment
03). Gate = step 6 commands passing.

## Spec authorship checklist

- [x] — (envelope; no spec text owed by this row)
