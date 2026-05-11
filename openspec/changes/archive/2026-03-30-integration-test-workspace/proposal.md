## Why

The extraction pipeline is the product — there is no runtime CSS fallback. Yet no test exercises the full production path: serialize system+theme → feed NAPI `analyzeProject()` → post-process CSS → final output. The three stages are tested in isolation from each other, and the contract boundary where they couple (serialization output → NAPI input) is completely untested.

Specific gaps:

1. **Theme serialization is hand-maintained in tests.** Canary tests feed `analyzeProject()` with ~80 hand-written theme JSON entries. If `tokens.serialize()` changes its output shape, canary tests keep passing with stale JSON while production breaks silently.

2. **No test connects serialize → NAPI.** `ds.serialize()` produces `propConfig` + `groupRegistry`. `tokens.serialize()` produces `scalesJson` + `variableMapJson` + `variableCss` + `contextualVarsJson`. These feed `analyzeProject()`. But no test builds a real system+theme, serializes both, and feeds the output through NAPI extraction.

3. **Post-processing has no targeted tests.** `resolveTransformPlaceholders`, `applyUnitFallback`, `resolveGlobalStyles` are pure functions used in production by the vite-plugin. Regressions only surface as broken showcase builds — no diagnostic test failures.

4. **Unused parallel orchestrator.** `runExtraction()` in `extract/pipeline/index.ts` duplicates what the vite-plugin does inline (prefix → NAPI → transforms → unit fallback). No production code imports it. It's a divergent path that could be exercised in tests instead of the real one.

## What Changes

- **Upgrade `packages/_integration/` workspace** — Replace the stale Emotion-era skeleton with an extraction pipeline integration test workspace. New test files call real APIs in production order: serialize → NAPI → post-process → assert.
- **Shared system+theme fixture** — A single `createSystem()` + `createTheme()` definition built with the real builder API, serialized once at test setup. Not hand-maintained JSON.
- **Component fixture files** — Real `.tsx` files using the builder chain that exercise core extraction behaviors (variants, states, compounds, responsive, system props, transforms).
- **Post-processing unit tests** — Targeted tests for `applyUnitFallback`, `applyPrefix`, `resolveGlobalStyles`, `resolveTransformPlaceholders` against known inputs.
- **Remove `runExtraction()` orchestrator** — Delete the unused JS orchestrator function, `ExtractionInput`, `ExtractionResult` types. Keep all utility re-exports (`applyUnitFallback`, `applyPrefix`, `resolveGlobalStyles`, `resolveTransformPlaceholders`, `camelToKebab`).
- **Migrate canary theme fixtures to programmatic** — Replace hand-maintained `themeJson`/`variableMapJson` in existing canary tests with output from `tokens.serialize()`. Canary tests stay in `packages/extract/tests/` — they test per-file `extract()` which is a valid unit test of the Rust crate.

## Capabilities

### New Capabilities
- `pipeline-integration-testing`: End-to-end tests exercising the full extraction pipeline (serialize → NAPI → post-process) using real system/theme builders and real component fixtures.
- `programmatic-test-fixtures`: Test fixture strategy that derives all serialized inputs from the real builder API rather than hand-maintaining JSON blobs.

### Modified Capabilities
- `css-post-processing`: Adding targeted unit tests for post-processing utilities that currently have no direct test coverage.

## Impact

- `packages/_integration/` — Gutted and rebuilt: new package.json (devDeps on `@animus-ui/system` + `@animus-ui/extract`), test files, fixture files, shared setup
- `packages/extract/pipeline/index.ts` — `runExtraction()`, `ExtractionInput`, `ExtractionResult` removed. All utility re-exports preserved.
- `packages/extract/tests/canary.test.ts` — Theme/variable-map fixtures replaced with `tokens.serialize()` output. Test logic unchanged.
- Root `package.json` — Workspace entry for `_integration` already exists; may need script updates
- No changes to the Rust crate, system package, or vite-plugin source code
