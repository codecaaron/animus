## MODIFIED Requirements

### Requirement: Theme evaluator extracts variables
The `evaluateThemeObject` function SHALL read from the theme's `.manifest` property directly instead of re-flattening the theme and scanning for `var(...)` patterns. The return shape (`{ scalesJson, variableMapJson, variableCss }`) SHALL be derived from manifest fields: `scalesJson` from `manifest.tokenMap`, `variableMapJson` from `manifest.variableMap`, `variableCss` from `manifest.variableCss`.

#### Scenario: evaluateThemeObject reads manifest
- **WHEN** `evaluateThemeObject(theme)` is called with a theme that has a `.manifest` property
- **THEN** it SHALL read `theme.manifest.tokenMap` for scales, `theme.manifest.variableMap` for variable mappings, and `theme.manifest.variableCss` for the CSS string
- **AND** it SHALL NOT flatten the theme or scan string values for `var(...)` patterns

#### Scenario: evaluateThemeObject return shape unchanged
- **WHEN** `evaluateThemeObject(theme)` is called
- **THEN** it SHALL return `{ scalesJson: string, variableMapJson: string, variableCss: string }` — the same shape as before, but sourced from manifest data

#### Scenario: Theme without manifest (backward compat during migration)
- **WHEN** `evaluateThemeObject(theme)` is called with a theme that has no `.manifest` property
- **THEN** it SHALL fall back to the current flattening + var() scanning behavior with a deprecation warning
