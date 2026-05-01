## Purpose

The `_integration` test suite SHALL exercise the complete production extraction path — build system+theme → serialize → read real fixture files → `analyzeProject()` → `resolveTransformPlaceholders()` → `applyUnitFallback()` — and assert the final CSS plus the structural shape of the returned manifest. Fixtures SHALL be real `.tsx` files using the builder chain (no synthetic string source), every step SHALL call the real function in the real package (no orchestrator wrappers), and manifest invariants (shape, dynamic-prop boundaries, system-prop map) SHALL be covered alongside CSS assertions.

## Requirements

### Requirement: Serialize contract round-trip

The integration test suite SHALL verify that output from `ds.serialize()` and `tokens.serialize()` on a real system+theme built with the builder API constitutes valid input to `analyzeProject()`. The NAPI call MUST succeed (not throw) and return a parseable JSON manifest. All serialization tests SHALL live in `serialization.test.ts` (not `contract.test.ts`).

#### Scenario: System serialization produces valid NAPI input

- **WHEN** a system is built with `createSystem().withGroups(standardGroups).build()` and serialized via `ds.serialize()`
- **THEN** `propConfig` and `groupRegistry` are valid JSON strings accepted by `analyzeProject()` without error

#### Scenario: Theme serialization produces valid NAPI input

- **WHEN** a theme is built with `createTheme()` using colors, spacing, and breakpoint scales and serialized via `tokens.serialize()`
- **THEN** `scalesJson`, `variableMapJson`, and `contextualVarsJson` are valid JSON strings accepted by `analyzeProject()` without error

#### Scenario: Contract round-trip produces non-empty CSS

- **WHEN** serialized system+theme output is fed to `analyzeProject()` with at least one extractable component fixture
- **THEN** the returned manifest contains non-empty `css` with `@layer` declarations

### Requirement: Full pipeline end-to-end test

The integration test suite SHALL exercise the complete production extraction path: build system+theme → serialize → read fixture files → `analyzeProject()` → `resolveTransformPlaceholders()` → `applyUnitFallback()` → assert final CSS. Every step MUST call the real function from the real package. All extraction integration tests SHALL live in `extraction.test.ts` (not `pipeline.test.ts`).

#### Scenario: Button component extracts through full pipeline

- **WHEN** a fixture button component using variants (size, intent) and states (hover, disabled) is extracted through the full pipeline
- **THEN** the final CSS contains the correct base styles, variant styles in `@layer variants`, state styles in `@layer states`, and responsive media queries where applicable
- **AND** the token invariant guard confirms no raw unresolved token names in the output

#### Scenario: Compound variants extract through full pipeline

- **WHEN** a fixture component with compound variants (e.g., size:small + intent:danger) is extracted through the full pipeline
- **THEN** the final CSS contains compound variant rules in `@layer compounds` that combine the specified variant conditions
- **AND** the token invariant guard confirms no raw unresolved token names in the output

#### Scenario: Transform placeholders resolve to computed values

- **WHEN** a fixture component uses a named transform (e.g., `size` transform) and is extracted through the full pipeline
- **THEN** `__TRANSFORM__` placeholders in the NAPI output are resolved to computed CSS values by `resolveTransformPlaceholders()` using the live transform functions from `ds.serialize().transforms`

#### Scenario: Unit fallback applies to bare numerics

- **WHEN** the full pipeline produces CSS with bare numeric values on length properties
- **THEN** `applyUnitFallback()` appends `px` to those values in the final output

#### Scenario: System props extract shared utility classes

- **WHEN** a fixture component uses system props (e.g., `<Box p={4} m={2}>`)
- **THEN** the manifest's `system_prop_map` contains shared utility class entries for the used props

### Requirement: Composition integration test

The integration test suite SHALL include tests that verify `compose()` components can be extracted through the full pipeline, producing correct CSS for composed slot components.

#### Scenario: Composed component extracts slot CSS

- **WHEN** a fixture component uses `compose()` with Root and Child slots sharing a variant
- **THEN** the full pipeline produces CSS containing class rules for each slot
- **AND** the CSS contains `@layer` declarations

#### Scenario: Shared variant props produce consistent CSS

- **WHEN** a composed component has shared variant props (e.g., size applied to both Root and Child)
- **THEN** the extracted CSS contains variant classes for both slots
- **AND** variant values resolve through theme scales (not raw strings)

#### Scenario: Compose with strict Root convention

- **WHEN** integration test fixtures define composed families
- **THEN** the Root slot SHALL use the literal key `"Root"` (PascalCase), not lowercase `"root"`

### Requirement: Extraction test parametrization

The extraction integration test SHALL use `test.each()` to parametrize variant resolution assertions where multiple variant options validate the same behavior.

#### Scenario: Size variant resolution parametrized

- **WHEN** testing that size variants (small, medium, large) resolve to expected CSS values
- **THEN** a `test.each()` block SHALL test each size → expected fontSize mapping as separate invocations

#### Scenario: Intent variant resolution parametrized

- **WHEN** testing that intent variants (primary, secondary) resolve to CSS variable references
- **THEN** a `test.each()` block SHALL test each intent → expected `var(--color-*)` mapping as separate invocations

### Requirement: Fixture files are real builder chain components

All component fixture files used by integration tests MUST be real `.tsx` files that import from `@animus-ui/system` and use the builder chain API (`createSystem()`, `.asElement()`, `.asComponent()`, `.withVariants()`, etc.). Synthetic strings or inline source code SHALL NOT be used.

#### Scenario: Fixture uses real builder API

- **WHEN** a fixture component file is authored for integration tests
- **THEN** it imports from `@animus-ui/system`, uses the real builder chain, and is a valid TypeScript file parseable by OXC

### Requirement: No pipeline orchestrator wrapper

Integration tests SHALL call `analyzeProject()` and post-processing utilities directly with the same call signature the vite-plugin uses. Tests MUST NOT use a wrapper function that hides the individual pipeline steps.

#### Scenario: Test calls NAPI directly

- **WHEN** an integration test exercises extraction
- **THEN** it calls `analyzeProject(fileEntriesJson, scalesJson, variableMapJson, contextualVarsJson, propConfig, groupRegistry, packageResolutionJson, devMode, prefix)` directly — not through an intermediary orchestrator

### Requirement: Manifest shape validation test

The `_integration` test suite SHALL include a dedicated test file (`manifest-shape.test.ts`) that validates the structural shape and internal consistency of the `UniverseManifest` returned by `analyzeProject()`.

#### Scenario: Component descriptors are complete

- **WHEN** the manifest from `analyzeProject()` is inspected
- **THEN** every component in `components` SHALL have non-empty `file`, `binding`, `class_name`, `replacement`, `terminal`, and `tag` fields

#### Scenario: Files-to-components mapping is consistent

- **WHEN** `manifest.files` is inspected
- **THEN** every component_id in the values SHALL exist as a key in `manifest.components`

#### Scenario: Provenance is reciprocal

- **WHEN** `manifest.reverse_provenance` contains parent_id → [child_ids]
- **THEN** each child component's `extends_from` SHALL equal the parent_id
- **AND** each component with `extends_from` set SHALL appear in `reverse_provenance[extends_from]`

#### Scenario: Fragments are consistent with components

- **WHEN** `manifest.component_fragments` is inspected
- **THEN** every key SHALL exist in `manifest.components`
- **AND** extracted components SHALL have at least one non-empty fragment layer

### Requirement: Dynamic props boundary test

The `_integration` test suite SHALL assert that components with only static literal prop values produce zero dynamic_props entries, and components with non-static values produce correct dynamic prop metadata.

#### Scenario: Fully static component has no dynamic props

- **WHEN** a fixture component uses only static string literals for all style values
- **THEN** the manifest SHALL contain zero entries in `dynamic_props` for that component's prop names
- **AND** all style properties SHALL appear in the component's CSS output

#### Scenario: Mixed static/dynamic component produces correct split

- **WHEN** a fixture component has some static literal values and some non-static values (identifiers, function calls)
- **THEN** static values SHALL appear in the component's CSS output
- **AND** non-static values SHALL appear in `dynamic_props` with `var_name`, `slot_class`, and `property` fields
- **AND** the bailed properties SHALL NOT disappear — they MUST produce CSS variable slot rules in `@layer anm-system`

### Requirement: System prop map validation

The `_integration` test suite SHALL assert that `system_prop_map` contains entries for system props used in fixture JSX.

#### Scenario: Used system props appear in map

- **WHEN** a fixture component's JSX includes system prop usage (e.g., `<Box p={4}>`)
- **THEN** `manifest.system_prop_map` SHALL contain an entry for that prop name
- **AND** the value mapping SHALL map to class names prefixed with `animus-u-` (the Animus utility-class prefix; the original proposal's `anm-` was stale — that's the layer prefix, distinct from the class prefix)

### Requirement: Integration pipeline invokes production NAPI signature

The shared `runPipeline` helper in `_integration/__tests__/run-pipeline.ts` SHALL invoke `analyzeProject` with the full production signature used by the vite-plugin adapter, including `selectorAliasesJson` and `selectorOrderJson` derived from the test-system's `toConfig()` output. All integration tests that use `runPipeline` SHALL exercise the same selector-alias code path as the production plugin — no selector-alias-less integration path SHALL exist. This closes the coverage gap that allowed selector-alias-related regressions to ship without integration-tier detection.

#### Scenario: runPipeline passes selector aliases

- **WHEN** an integration test calls `runPipeline(entries)` with the standard test-system fixture
- **THEN** the NAPI call SHALL receive non-null `selectorAliasesJson` and `selectorOrderJson` sourced from `config.selectorAliases` and `config.selectorOrder`

#### Scenario: runPipeline matches vite-plugin argument arity

- **WHEN** the vite-plugin's `runAnalysis` invokes `analyzeProject` with N arguments
- **THEN** `runPipeline` SHALL invoke `analyzeProject` with the same N arguments in the same order — placeholder nulls are permitted for arguments with no integration-test-side analog (e.g. `pathAliasesJson`), but every argument slot SHALL be passed

#### Scenario: Existing integration tests pass under extended signature

- **WHEN** the existing integration test suite (`extraction.test.ts`, `serialization.test.ts`, `composition.test.ts`, `post-processing.test.ts`, `manifest-shape.test.ts`, `cascade-round-trip.test.ts`, keyframes tests) is re-run after extending `runPipeline`
- **THEN** every test SHALL pass without modification — the extension SHALL be additive, not behavior-changing, for fixtures that do not exercise selector aliases

### Requirement: Selector-rule fixture matrix registered

The integration test suite SHALL maintain a permanent selector-rule authoring fixture matrix at `_integration/fixtures/components/selector-rules/` covering the authoring cross-product that previously exposed regressions: raw-selector + alias mixes, token references inside shorthand values, compound aliases (e.g. `_selected`), `createElement(bareIdent, ...)` usage patterns, unresolvable tokens (characterization), and full chains (`.styles+_hover+_focusVisible+.variant+.states`). The matrix SHALL serve as regression acceptance criteria. Current-broken behaviors SHALL be expressed as sealed tests paired with skipped acceptance tests, so fixing the underlying bug requires a coordinated edit that prevents silent behavior change.

#### Scenario: Selector-rules fixture directory discoverable

- **WHEN** an integration test requires a selector-rule fixture
- **THEN** it SHALL be loadable via `readFixtureFile(join(__dirname, '..', 'fixtures', 'components', 'selector-rules'), filename)`

#### Scenario: Top-level fixture walk does not include the subdirectory

- **WHEN** a multi-file test calls `readFixtureFiles(COMPONENTS)` on the top-level `components/` directory
- **THEN** the walk SHALL NOT recurse into `selector-rules/` — selector-rule fixtures SHALL NOT leak into unrelated multi-file test scope

#### Scenario: Bug seal test locks current broken behavior

- **WHEN** a bug's acceptance test is marked `test.skip('[Bug N] ...')` with the expected-post-fix assertion, paired with a `test('[Bug N seal — current broken behavior]', ...)` that passes today by asserting the broken behavior
- **THEN** fixing the underlying bug SHALL cause the seal test to fail — requiring a coordinated edit to delete the seal and unskip the acceptance test, preventing silent regression drift
