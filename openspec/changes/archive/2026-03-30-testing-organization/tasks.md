## 1. Canary Behavioral Restructure

- [x] 1.1 Restructure canary.test.ts top-level describe blocks from component-oriented to behavior-oriented (base style extraction, variant resolution, responsive generation, compound variants, state extraction, transform placeholders, token alias resolution, extension chains, reconciliation, system props, custom props, manifest and transformation)
- [x] 1.2 Move existing tests into their new behavioral describe blocks — no logic changes, just regrouping
- [x] 1.3 Verify all 150 canary tests still pass after restructure (`bun run test:canary`)

## 2. Integration File Renames

- [x] 2.1 Rename `packages/_integration/__tests__/contract.test.ts` → `serialization.test.ts` via git mv
- [x] 2.2 Rename `packages/_integration/__tests__/pipeline.test.ts` → `extraction.test.ts` via git mv
- [x] 2.3 Verify all integration tests still pass after rename (`bun test`)

## 3. Token Invariant Guard

- [x] 3.1 Create a reusable `assertNoUnresolvedTokens(css: string)` helper in `_integration/__tests__/` that derives token scale names from the shared theme fixture (not a hand-maintained list)
- [x] 3.2 Add token invariant guard to every `runPipeline()` call site in `extraction.test.ts` (button, compounds, transforms, responsive, multi-file)
- [x] 3.3 Verify the guard would catch a raw token: temporarily modify a fixture to reference a non-existent token, confirm the guard fails, revert

## 4. test.each() Parametrization

- [x] 4.1 Convert button size variant assertions in extraction.test.ts to `test.each()` over `[['small', '0.875rem'], ['medium', '1rem'], ['large', '1.25rem']]`
- [x] 4.2 Convert intent variant assertions in extraction.test.ts to `test.each()` over intent → expected `var(--color-*)` mapping
- [x] 4.3 Convert compound variant scale assertions to `test.each()` where repetitive (fontSize, padding scale values)
- [x] 4.4 Convert post-processing.test.ts `applyUnitFallback` length-property tests to `test.each()` over property × value pairs
- [x] 4.5 Convert `resolveTokenAliases` tests to `test.each()` where multiple alias patterns test the same resolution behavior

## 5. Composition Integration Test

- [x] 5.1 Create `packages/_integration/fixtures/components/composition.tsx` — a composed component with Root + Child slots sharing a variant (e.g., size), using the existing `ds` builder
- [x] 5.2 Create `packages/_integration/__tests__/composition.test.ts` — extract the composition fixture through `runPipeline()`, assert CSS contains slot classes and @layer declarations
- [x] 5.3 Add shared variant resolution assertions: both Root and Child slot CSS resolve variant values through theme scales
- [x] 5.4 Add token invariant guard to composition test

## 6. Extraction Test Behavioral Describes

- [x] 6.1 Restructure extraction.test.ts describe blocks to behavioral names (variant resolution, compound resolution, transform resolution, responsive extraction, multi-file extraction) — aligning with the canary behavioral taxonomy
- [x] 6.2 Add behavioral describe blocks within serialization.test.ts if needed (serialization shape, round-trip validation)

## 7. TESTING.md Manifest

- [x] 7.1 Create `TESTING.md` at repo root with behavior → tier → file mapping table covering all 15 system behaviors
- [x] 7.2 Add tier summary table (tier name, run command, file count, purpose)
- [x] 7.3 Add current test counts per tier
- [x] 7.4 Add assertion pattern guidance per tier (snapshots for structure, explicit for semantics, test.each for matrices, @ts-expect-error for types)

## 8. Verification

- [x] 8.1 Run `bun run verify` — all tests pass, no regressions
- [x] 8.2 Run `bun run test:canary` — confirm canary count is still 150
- [x] 8.3 Confirm total test count is >= 504 (should increase with composition tests)
