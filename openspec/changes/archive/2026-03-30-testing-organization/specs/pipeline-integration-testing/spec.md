## ADDED Requirements

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

### Requirement: Extraction test parametrization
The extraction integration test SHALL use `test.each()` to parametrize variant resolution assertions where multiple variant options validate the same behavior.

#### Scenario: Size variant resolution parametrized
- **WHEN** testing that size variants (small, medium, large) resolve to expected CSS values
- **THEN** a `test.each()` block SHALL test each size → expected fontSize mapping as separate invocations

#### Scenario: Intent variant resolution parametrized
- **WHEN** testing that intent variants (primary, secondary) resolve to CSS variable references
- **THEN** a `test.each()` block SHALL test each intent → expected `var(--color-*)` mapping as separate invocations

## MODIFIED Requirements

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
