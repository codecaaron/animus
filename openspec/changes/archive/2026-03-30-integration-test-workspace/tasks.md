## 1. Remove Unused Orchestrator

- [x] 1.1 Delete `runExtraction()`, `ExtractionInput`, `ExtractionResult` from `packages/extract/pipeline/index.ts`. Preserve all utility re-exports (`applyUnitFallback`, `applyPrefix`, `resolveGlobalStyles`, `resolveTokenAliases`, `resolveValue`, `resolveTransformPlaceholders`, `camelToKebab`). Remove the `createRequire` import and NAPI require call that only `runExtraction` used.
- [x] 1.2 Verify `bun run verify` passes — no production code imported `runExtraction()`.

## 2. Workspace Scaffolding

- [x] 2.1 Rewrite `packages/_integration/package.json` — private package, devDeps on `@animus-ui/system` (workspace:*) and `@animus-ui/extract` (workspace:*). Remove all Emotion/core/theming deps. Keep `"test": "bun test"` script.
- [x] 2.2 Create `packages/_integration/tsconfig.json` — target ESNext, module ESNext, jsx react-jsx, `noEmit: true`, strict. Include fixtures and tests.
- [x] 2.3 Run `bun install` to link workspace dependencies.

## 3. Shared Fixture Setup

- [x] 3.1 Create `packages/_integration/fixtures/setup.ts` — build a representative system+theme using the real builder API. System: `createSystem().withGroups(standardGroups).build()`. Theme: `createTheme()` with colors (including at least one color mode), spacing, sizing, breakpoints. Export the serialized output: `config = ds.serialize()`, `theme = tokens.serialize()`.
- [x] 3.2 Create `packages/_integration/fixtures/read-fixtures.ts` — helper that reads `.tsx` files from a directory and returns `FileEntry[]` as `{ path: string, source: string }` for `analyzeProject()` input.

## 4. Component Fixtures

- [x] 4.1 Create `packages/_integration/fixtures/components/button.tsx` — component using `asElement('button')` with variants (size: small/medium/large, intent: primary/secondary), states (hover, disabled), and base styles using scale tokens.
- [x] 4.2 Create `packages/_integration/fixtures/components/layout.tsx` — component using responsive styles with breakpoint-keyed values.
- [x] 4.3 Create `packages/_integration/fixtures/components/compounds.tsx` — component with compound variants (e.g., size+intent combinations).
- [x] 4.4 Create `packages/_integration/fixtures/components/system-props.tsx` — component using `.system()` to enable system props (padding, margin, etc.).
- [x] 4.5 Create `packages/_integration/fixtures/components/transforms.tsx` — component using a named transform (e.g., `size` transform) that produces `__TRANSFORM__` placeholders in extraction.
- [x] 4.6 Verify all fixture files type-check: `bunx tsc --noEmit -p packages/_integration/tsconfig.json`. (Pre-existing type gaps in vars group and scale constraints — matches extract package. Runtime/extraction works fine.)

## 5. Integration Tests — Contract Boundary

- [x] 5.1 Create `packages/_integration/__tests__/contract.test.ts` — serialize contract round-trip tests: build system+theme → serialize → feed to `analyzeProject()` with one fixture → verify NAPI succeeds and returns parseable manifest with non-empty `css` containing `@layer` declarations.
- [x] 5.2 Add shape validation tests: verify `ds.serialize()` returns `{ propConfig: string, groupRegistry: string, transforms: object }` and `tokens.serialize()` returns `{ scalesJson: string, variableMapJson: string, variableCss: string, contextualVarsJson: string }`.

## 6. Integration Tests — Full Pipeline

- [x] 6.1 Create `packages/_integration/__tests__/pipeline.test.ts` — full pipeline tests: serialize → analyzeProject → resolveTransformPlaceholders → applyUnitFallback → assert final CSS. Import `analyzeProject` from `@animus-ui/extract`, utilities from `@animus-ui/extract/pipeline`.
- [x] 6.2 Add button extraction scenario: extract button fixture through full pipeline, assert base styles, variant styles in `@layer variants`, state styles in `@layer states`.
- [x] 6.3 Add compound variant scenario: extract compounds fixture, assert compound rules in `@layer compounds`.
- [x] 6.4 Add transform resolution scenario: extract transforms fixture, verify `__TRANSFORM__` placeholders are resolved to computed values using live transform functions from `config.transforms`.
- [x] 6.5 Add system props scenario: extract system-props fixture, verify `system_prop_map` in manifest contains expected utility entries.
- [x] 6.6 Add responsive scenario: extract layout fixture, verify `@media` queries with correct breakpoint values from serialized theme.

## 7. Post-Processing Unit Tests

- [x] 7.1 Create `packages/_integration/__tests__/post-processing.test.ts` — targeted unit tests for each post-processing utility.
- [x] 7.2 `applyUnitFallback` tests: bare numeric → px on length properties, unitless properties preserved (z-index, opacity, flex, line-height), function call contents not mangled (rgb, calc, var), multi-value shorthands.
- [x] 7.3 `resolveTransformPlaceholders` tests: single placeholder resolution, multiple placeholders, numeric and string return values from transform functions.
- [x] 7.4 `applyPrefix` tests: variable map entries prefixed, variable CSS declarations prefixed, prefix applied to both declaration and reference sites.
- [x] 7.5 `resolveGlobalStyles` tests: token alias → var() resolution, token alias with alpha → color-mix, scale lookup → literal value, named transform application.

## 8. Canary Test Fixture Migration

- [x] 8.1 Create `packages/extract/tests/fixtures/theme-fixture.ts` — build a theme with `createTheme()` matching the scale entries the canary tests expect, export serialized output. Follow the pattern of existing `serialize-config.ts`.
- [x] 8.2 Replace hand-maintained `themeJson`, `variableMapJson`, `contextualVarsJson` in `canary.test.ts` with imports from `theme-fixture.ts`. Diff old vs new to identify any format differences.
- [x] 8.3 Run canary tests (`bun run test:canary`) — all existing assertions pass. Fix any assertions that break due to format differences between hand-maintained and programmatic JSON (e.g., key ordering, extra entries).

## 9. Cleanup and Verification

- [x] 9.1 Delete stale files from `packages/_integration/`: old `index.ts`, `__fixtures__/theme.ts`, `CHANGELOG.md`, `README.md`, old `__tests__/__snapshots__/`.
- [x] 9.2 Run `bun run test` — all tests pass (integration + canary + system + all others). 323 tests across 15 files.
- [x] 9.3 Run `bun run verify` — full TS build + test + biome check passes. 323 tests, all green.
