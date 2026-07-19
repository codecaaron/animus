## MODIFIED Requirements

### Requirement: Full pipeline end-to-end test

The integration test suite SHALL exercise the complete production extraction path: build system+theme → serialize → read fixture files → `analyzeProject()` with embedded transform evaluation → `applyUnitFallback()` → assert final CSS. Every step MUST call the real function from the real package. All extraction integration tests SHALL live in `extraction.test.ts` (not `pipeline.test.ts`).

#### Scenario: Button component extracts through full pipeline

- **WHEN** a fixture button component using variants (size, intent) and states (hover, disabled) is extracted through the full pipeline
- **THEN** the final CSS contains the correct base styles, variant styles in `@layer variants`, state styles in `@layer states`, and responsive media queries where applicable
- **AND** the token invariant guard confirms no raw unresolved token names in the output

#### Scenario: Compound variants extract through full pipeline

- **WHEN** a fixture component with compound variants (e.g., size:small + intent:danger) is extracted through the full pipeline
- **THEN** the final CSS contains compound variant rules in `@layer compounds` that combine the specified variant conditions
- **AND** the token invariant guard confirms no raw unresolved token names in the output

#### Scenario: Named transform evaluates in the extraction engine

- **WHEN** a real fixture defines a self-contained named transform whose computed value differs from raw and built-in fallback values
- **THEN** the raw NAPI CSS contains the fixture callback's computed value
- **AND** the raw NAPI CSS contains no `__TRANSFORM__` placeholder

#### Scenario: Unit fallback applies to bare numerics

- **WHEN** the full pipeline produces CSS with bare numeric values on length properties
- **THEN** `applyUnitFallback()` appends `px` to those values in the final output

#### Scenario: System props extract shared utility classes

- **WHEN** a fixture component uses system props (e.g., `<Box p={4} m={2}>`)
- **THEN** the manifest's `system_prop_map` contains shared utility class entries for the used props
