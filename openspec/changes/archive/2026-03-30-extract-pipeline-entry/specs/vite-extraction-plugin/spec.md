## MODIFIED Requirements

### Requirement: Theme evaluation at build start
Theme evaluation SHALL use the theme's `.serialize()` method when available (renamed from `.evaluate()`). Legacy fallback for themes without `.serialize()` remains in the plugin.

#### Scenario: Modern theme with serialize method
- **WHEN** the loaded theme object has a `.serialize()` method
- **THEN** the plugin SHALL call `theme.serialize()` to obtain `{ scalesJson, variableMapJson, variableCss, contextualVarsJson }`

#### Scenario: Legacy theme without serialize method
- **WHEN** the loaded theme object does NOT have a `.serialize()` method (pre-manifest theme or JSON-deserialized)
- **THEN** the plugin SHALL fall back to the local legacy evaluation path

### Requirement: Post-processing utilities imported from extract
The plugin SHALL import post-processing utilities from `@animus-ui/extract/pipeline` instead of implementing them locally. The plugin calls `analyzeProject()` directly for NAPI analysis, then composes extract's pipeline utilities for post-processing.

#### Scenario: Unit fallback via extract
- **WHEN** extracted CSS needs unit fallback
- **THEN** the plugin SHALL import and call `applyUnitFallback` from `@animus-ui/extract/pipeline`

#### Scenario: Prefix application via extract
- **WHEN** CSS variables need namespace prefixing
- **THEN** the plugin SHALL import and call `applyPrefix` from `@animus-ui/extract/pipeline`

#### Scenario: Global styles resolved via extract
- **WHEN** global style blocks are discovered during system loading
- **THEN** the subprocess SHALL import `resolveGlobalStyles` from `@animus-ui/extract/pipeline` for resolution

#### Scenario: Transform resolution remains a host concern
- **WHEN** extracted CSS contains `__TRANSFORM__` placeholders
- **THEN** the plugin SHALL resolve them via subprocess (ESM isolation for live transform functions). This is a host concern — transform functions require the system module loaded in a subprocess, which cannot be delegated to the extract pipeline.

#### Scenario: NAPI called directly
- **WHEN** the plugin runs analysis during buildStart
- **THEN** it SHALL call `analyzeProject()` from `@animus-ui/extract` directly — not through an intermediary wrapper
