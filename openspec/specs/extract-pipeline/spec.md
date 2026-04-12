## ADDED Requirements

### Requirement: Pipeline utility exports
Extract SHALL export pipeline utility functions from `@animus-ui/extract/pipeline` that any bundler host can compose to complete the extraction pipeline. These are the shared bridge between the Rust NAPI core and framework-specific plugin code.

#### Scenario: Utilities importable from pipeline subpath
- **WHEN** a bundler plugin imports from `@animus-ui/extract/pipeline`
- **THEN** it SHALL have access to `applyUnitFallback`, `applyPrefix`, `resolveGlobalStyles`, `resolveTokenAliases`, `resolveValue`, `assembleStylesheet`, `validateLayerOrder`, `extractSystemFilePackages`, and `camelToKebab`
- **AND** it SHALL NOT export `execSubprocess` or `detectRuntime` (dead code removed)

#### Scenario: No orchestrator wrapper
- **WHEN** a bundler plugin needs to run the extraction pipeline
- **THEN** it SHALL call `analyzeProject()` from `@animus-ui/extract` directly for NAPI analysis, then compose pipeline utilities for post-processing. There is no single `runExtraction()` wrapper — each host owns its own lifecycle.

#### Scenario: Manifest includes pipeline timing
- **WHEN** `analyzeProject()` completes and returns its JSON manifest
- **THEN** the manifest SHALL include a `timing` object containing per-phase durations and metadata (file count, cache hits, total duration)

### Requirement: Global styles resolution function
Extract SHALL export a `resolveGlobalStyles()` function that resolves prop shorthand in global style objects to CSS.

#### Scenario: Prop shorthand resolved
- **WHEN** `resolveGlobalStyles({ 'html, body': { bg: 'background', color: 'text' } }, ...)` is called
- **THEN** the result SHALL contain CSS with resolved property names and theme scale values

#### Scenario: Token aliases resolved
- **WHEN** a global style value contains `{colors.ember/40}`
- **THEN** the resolved CSS SHALL contain `color-mix(in srgb, var(--color-ember) 40%, transparent)`

#### Scenario: @keyframes blocks resolved
- **WHEN** a global style block contains an `@keyframes` selector with nested percentages
- **THEN** the resolved CSS SHALL contain properly formatted `@keyframes { 0% { ... } 100% { ... } }` with prop shorthand resolved within each frame

### Requirement: Unit fallback function
Extract SHALL export an `applyUnitFallback()` function. The function SHALL import the unitless property set from `@animus-ui/properties` rather than defining it inline.

#### Scenario: Bare numerics get px suffix
- **WHEN** CSS contains `padding: 16` (bare numeric on a length property)
- **THEN** the output SHALL contain `padding: 16px`

#### Scenario: Unitless properties preserved
- **WHEN** CSS contains `opacity: 0.5` or `z-index: 100`
- **THEN** the output SHALL NOT add a px suffix

#### Scenario: Unitless set sourced from properties package
- **WHEN** `applyUnitFallback` checks whether a property is unitless
- **THEN** it SHALL use `UNITLESS_PROPERTIES` imported from `@animus-ui/properties`, not an inline definition

### Requirement: Prefix application covers all serialized artifacts
`applyPrefix` SHALL apply the namespace prefix to ALL serialized theme artifacts: `variableMapJson`, `variableCss`, `themeJson`, AND `contextualVarsJson`.

#### Scenario: Contextual variable CSS with prefix
- **WHEN** prefix is `"acme"` and the theme declares `declareContextualVars({ colors: ['bg'] })`
- **THEN** the emitted contextual variable CSS SHALL use `--acme-current-bg` (not `--current-bg`) and reference `var(--acme-color-bg)` (not `var(--color-bg)`)

#### Scenario: No prefix configured
- **WHEN** prefix is empty or undefined
- **THEN** `applyPrefix` SHALL return `contextualVarsJson` unchanged

### Requirement: Manifest includes per-component CSS fragments
The `analyzeProject()` manifest SHALL include a `component_fragments` field containing per-component CSS for the 4 splittable layers (base, variants, compounds, states). The `css` and `sheets` fields SHALL continue to be present and unchanged.

#### Scenario: Fragments alongside existing fields
- **WHEN** `analyzeProject()` returns the manifest JSON
- **THEN** the manifest SHALL contain `css` (full concatenated), `sheets` (per-layer), AND `component_fragments` (per-component per-layer)

### Requirement: Manifest includes reverse provenance
The `analyzeProject()` manifest SHALL include a `reverse_provenance` field mapping parent component_ids to their direct children for transitive cache invalidation.

#### Scenario: Reverse provenance present
- **WHEN** `analyzeProject()` returns the manifest JSON and extension chains exist
- **THEN** the manifest SHALL contain `reverse_provenance` mapping parent component_ids to arrays of child component_ids
