## ADDED Requirements

### Requirement: Pipeline utility exports
Extract SHALL export pipeline utility functions from `@animus-ui/extract/pipeline` that any bundler host can compose to complete the extraction pipeline. These are the shared bridge between the Rust NAPI core and framework-specific plugin code.

#### Scenario: Utilities importable from pipeline subpath
- **WHEN** a bundler plugin imports from `@animus-ui/extract/pipeline`
- **THEN** it SHALL have access to `applyUnitFallback`, `applyPrefix`, `resolveGlobalStyles`, `resolveTokenAliases`, `resolveValue`, `resolveTransformPlaceholders`, and `camelToKebab`

#### Scenario: No orchestrator wrapper
- **WHEN** a bundler plugin needs to run the extraction pipeline
- **THEN** it SHALL call `analyzeProject()` from `@animus-ui/extract` directly for NAPI analysis, then compose pipeline utilities for post-processing. There is no single `runExtraction()` wrapper — each host owns its own lifecycle.

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

### Requirement: Transform placeholder resolution function
Extract SHALL export a `resolveTransformPlaceholders()` function.

#### Scenario: Placeholder pattern replaced
- **WHEN** CSS contains `__TRANSFORM__size__0.5__` and transforms include a `size` function
- **THEN** the output SHALL replace the placeholder with the transform function's return value

### Requirement: Unit fallback function
Extract SHALL export an `applyUnitFallback()` function.

#### Scenario: Bare numerics get px suffix
- **WHEN** CSS contains `padding: 16` (bare numeric on a length property)
- **THEN** the output SHALL contain `padding: 16px`

#### Scenario: Unitless properties preserved
- **WHEN** CSS contains `opacity: 0.5` or `z-index: 100`
- **THEN** the output SHALL NOT add a px suffix

### Requirement: Prefix application function
Extract SHALL export an `applyPrefix()` function.

#### Scenario: Variable map and CSS prefixed
- **WHEN** `applyPrefix('myapp', variableMapJson, variableCss)` is called
- **THEN** all CSS custom properties SHALL use `--myapp-*` prefix in both the variable map and variable CSS
