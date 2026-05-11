## MODIFIED Requirements

### Requirement: CSS variable definition emission
The Vite plugin SHALL emit CSS custom property definitions derived from the theme's manifest. Variable definitions SHALL appear BEFORE the `@layer` declaration. CSS variable names SHALL use dash-join format regardless of internal dot-path storage.

#### Scenario: Root variable definitions from nested colors
- **WHEN** the theme has nested colors `{ gray: { 50: '#fafafa' } }` and manifest contains the flattened CSS
- **THEN** the extracted CSS SHALL contain `:root { --color-gray-50: #fafafa; }`

#### Scenario: Mode variable definitions
- **WHEN** the theme has color modes with dot-path aliases
- **THEN** the extracted CSS SHALL contain mode blocks with dash-join variable names: `[data-color-mode="dark"] { --color-primary: ...; }`

#### Scenario: All modes get explicit selectors
- **WHEN** the theme has color modes defined via `addColorModes`
- **THEN** the extracted CSS SHALL contain a `[data-color-mode="X"]` block for EVERY mode

#### Scenario: Variables before @layer
- **WHEN** the extracted CSS includes both variable definitions and component CSS
- **THEN** the variable definitions SHALL appear BEFORE the `@layer` declaration

### Requirement: Theme evaluator extracts variables
The `evaluateTheme` function SHALL return flattened scale JSON and CSS variable strings. The flat data SHALL be produced from `serialize()`, which flattens nested theme data at the serialization boundary.

#### Scenario: evaluateTheme return shape
- **WHEN** `evaluateTheme(ssrLoadModule, themePath)` is called
- **THEN** it SHALL return `{ scalesJson, variableMapJson, variableCss, contextualVarsJson }`

#### Scenario: Nested theme produces correct variable CSS
- **WHEN** a theme stores colors nested as `{ gray: { 50: '#fafafa' } }`
- **THEN** `variableCss` SHALL produce `--color-gray-50: #fafafa` — dot-path internally, dash-join in CSS output
