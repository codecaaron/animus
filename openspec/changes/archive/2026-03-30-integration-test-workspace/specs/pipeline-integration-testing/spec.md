## ADDED Requirements

### Requirement: Serialize contract round-trip
The integration test suite SHALL verify that output from `ds.serialize()` and `tokens.serialize()` on a real system+theme built with the builder API constitutes valid input to `analyzeProject()`. The NAPI call MUST succeed (not throw) and return a parseable JSON manifest.

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
The integration test suite SHALL exercise the complete production extraction path: build system+theme → serialize → read fixture files → `analyzeProject()` → `resolveTransformPlaceholders()` → `applyUnitFallback()` → assert final CSS. Every step MUST call the real function from the real package.

#### Scenario: Button component extracts through full pipeline
- **WHEN** a fixture button component using variants (size, intent) and states (hover, disabled) is extracted through the full pipeline
- **THEN** the final CSS contains the correct base styles, variant styles in `@layer variants`, state styles in `@layer states`, and responsive media queries where applicable

#### Scenario: Compound variants extract through full pipeline
- **WHEN** a fixture component with compound variants (e.g., size:small + intent:danger) is extracted through the full pipeline
- **THEN** the final CSS contains compound variant rules in `@layer compounds` that combine the specified variant conditions

#### Scenario: Transform placeholders resolve to computed values
- **WHEN** a fixture component uses a named transform (e.g., `size` transform) and is extracted through the full pipeline
- **THEN** `__TRANSFORM__` placeholders in the NAPI output are resolved to computed CSS values by `resolveTransformPlaceholders()` using the live transform functions from `ds.serialize().transforms`

#### Scenario: Unit fallback applies to bare numerics
- **WHEN** the full pipeline produces CSS with bare numeric values on length properties
- **THEN** `applyUnitFallback()` appends `px` to those values in the final output

#### Scenario: System props extract shared utility classes
- **WHEN** a fixture component uses system props (e.g., `<Box p={4} m={2}>`)
- **THEN** the manifest's `system_prop_map` contains shared utility class entries for the used props

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
