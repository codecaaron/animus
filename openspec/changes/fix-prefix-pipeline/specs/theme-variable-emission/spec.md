## MODIFIED Requirements

### Requirement: Theme evaluator extracts variables
The `evaluateTheme` function SHALL return flattened scale JSON and CSS variable strings. The flat data SHALL be produced from `serialize()`, which flattens nested theme data at the serialization boundary.

#### Scenario: evaluateTheme return shape
- **WHEN** `evaluateTheme(ssrLoadModule, themePath)` is called
- **THEN** it SHALL return `{ scalesJson, variableMapJson, variableCss, contextualVarsJson }`

#### Scenario: Nested theme produces correct variable CSS
- **WHEN** a theme stores colors nested as `{ gray: { 50: '#fafafa' } }`
- **THEN** `variableCss` SHALL produce `--color-gray-50: #fafafa` — dot-path internally, dash-join in CSS output

#### Scenario: varRef returns prefixed references when prefix configured
- **WHEN** the system is created with `createSystem({ prefix: 'ax' })`
- **AND** `tokens.varRef('colors.ember')` is called at runtime
- **THEN** it SHALL return `'var(--ax-color-ember)'`

#### Scenario: varRef returns unprefixed references without prefix
- **WHEN** the system is created without a prefix
- **AND** `tokens.varRef('colors.ember')` is called at runtime
- **THEN** it SHALL return `'var(--color-ember)'`

#### Scenario: Serialized config includes prefix
- **WHEN** the system is created with `createSystem({ prefix: 'ax' })`
- **AND** `system.serialize()` is called
- **THEN** the serialized output SHALL include `prefix: 'ax'`
- **AND** the plugin SHALL use this prefix, validating against plugin-level config if both are specified
