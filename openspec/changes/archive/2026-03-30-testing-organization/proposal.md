## Why

Tests are organized by where they landed when written, not by what behavior they guard. 150 canary tests live in one file with component-oriented describe blocks. Integration test files are named by pipeline stage (contract, pipeline) rather than the behavior they verify. There's no way to answer "is behavior X tested?" without reading every test file. The unresolved token invariant gap remains open — raw token names can appear in extracted CSS without any test catching it.

## What Changes

- Restructure canary.test.ts describe blocks from component-oriented ("Canary: Button extraction") to behavior-oriented ("variant resolution", "responsive generation", etc.) — same file, same tests, behavioral index
- Rename integration test files: `contract.test.ts` → `serialization.test.ts`, `pipeline.test.ts` → `extraction.test.ts` — names match the behavior tested
- Add `composition.test.ts` integration test — compose() through the extraction pipeline, filling a convergence gap where composition is only tested at unit level
- Add unresolved token invariant guards — systematic post-extraction assertion that CSS values don't contain raw unresolved token names
- Convert repetitive assertion patterns to `test.each()` parametrized tests where multiple inputs validate the same behavior
- Create `TESTING.md` manifest at repo root — maps each of the 15 system behaviors to its primary test tier, file location, and assertion pattern

## Capabilities

### New Capabilities
- `behavioral-test-organization`: Behavioral taxonomy mapping 15 system behaviors to test tiers (extraction edge, pipeline edge, unit core, type contract, post-build seal). Defines file naming conventions, describe block naming, and the TESTING.md coverage certainty manifest.

### Modified Capabilities
- `pipeline-integration-testing`: Adding composition integration test, renaming files to behavioral names, adding token invariant guards, converting to test.each where appropriate.

## Impact

- `packages/extract/tests/canary.test.ts` — describe block restructure (no test logic changes)
- `packages/_integration/__tests__/contract.test.ts` — renamed to `serialization.test.ts`
- `packages/_integration/__tests__/pipeline.test.ts` — renamed to `extraction.test.ts`, gains test.each parametrization and token invariant guards
- `packages/_integration/__tests__/composition.test.ts` — new file
- `TESTING.md` — new file at repo root
- No changes to Rust tests, type tests, post-build assertions, or package dependencies
