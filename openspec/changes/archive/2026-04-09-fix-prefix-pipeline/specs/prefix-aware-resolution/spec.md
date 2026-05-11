## ADDED Requirements

### Requirement: applyPrefix preserves contextual var lookup keys
The `applyPrefix()` function SHALL NOT transform contextual variable names in `contextualVarsJson`. Contextual var names are token-path lookup keys used by the Rust resolver for matching — they are not CSS variable names. The Rust resolver SHALL apply the prefix at emission time.

#### Scenario: Contextual var names unchanged after prefix
- **WHEN** `applyPrefix('ax', variableMapJson, variableCss, themeJson, contextualVarsJson)` is called
- **AND** `contextualVarsJson` contains `{ "colors": ["current-bg"] }`
- **THEN** the returned `contextualVarsJson` SHALL contain `{ "colors": ["current-bg"] }`
- **AND** the names SHALL NOT be prefixed to `["ax-current-bg"]`

#### Scenario: Variable map values are still prefixed
- **WHEN** `applyPrefix('ax', ...)` is called
- **AND** `variableMapJson` contains `{ "colors.ember": "--color-ember" }`
- **THEN** the returned `variableMapJson` SHALL contain `{ "colors.ember": "--ax-color-ember" }`

### Requirement: ResolveContext carries prefix
The Rust `ResolveContext` struct SHALL include a `prefix: Option<&str>` field that is threaded through all resolution functions that produce CSS `var()` references for contextual variables.

#### Scenario: Project analysis passes prefix
- **WHEN** `analyze()` is called with `layer_prefix: Some("ax")`
- **THEN** the `ResolveContext` constructed for resolution SHALL have `prefix: Some("ax")`

#### Scenario: Per-file extraction has no prefix
- **WHEN** `extract()` is called (single-file mode)
- **THEN** the `ResolveContext` SHALL have `prefix: None`

#### Scenario: No prefix produces unchanged behavior
- **WHEN** `ResolveContext` has `prefix: None`
- **THEN** all resolution functions SHALL behave identically to pre-change behavior

### Requirement: Prefixed contextual var emission
The Rust `resolve_contextual_var()` function SHALL emit CSS `var()` references with the prefix applied when the resolution context carries a prefix.

#### Scenario: Prefixed contextual var resolution
- **WHEN** a component has `bg: 'current-bg'` with `current-bg` in contextual vars for `colors`
- **AND** prefix is `Some("ax")`
- **THEN** the extracted CSS SHALL contain `background: var(--ax-current-bg)`

#### Scenario: Prefixed contextual var in token ref syntax
- **WHEN** a component has `boxShadow: '0 0 8px {colors.current-bg}'`
- **AND** prefix is `Some("ax")`
- **THEN** the extracted CSS SHALL contain `box-shadow: 0 0 8px var(--ax-current-bg)`

#### Scenario: Prefixed contextual var with opacity
- **WHEN** a component has `color: '{colors.current-bg/85}'`
- **AND** prefix is `Some("ax")`
- **THEN** the extracted CSS SHALL contain `color: color-mix(in srgb, var(--ax-current-bg) 85%, transparent)`

#### Scenario: Unprefixed contextual var resolution
- **WHEN** a component has `bg: 'current-bg'` with `current-bg` in contextual vars for `colors`
- **AND** prefix is `None`
- **THEN** the extracted CSS SHALL contain `background: var(--current-bg)`
