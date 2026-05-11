## ADDED Requirements

### Requirement: Theme build output exposes evaluate method
The built theme object returned by `ThemeBuilder.build()` SHALL expose a non-enumerable `.evaluate()` method that returns the 4 JSON string artifacts the extraction pipeline requires.

#### Scenario: Evaluate returns pipeline-ready JSON strings
- **WHEN** consumer calls `tokens.evaluate()` on a theme built via `createTheme().build()`
- **THEN** the return value SHALL contain `{ scalesJson, variableMapJson, variableCss, contextualVarsJson }` where all JSON fields are `string` type

#### Scenario: scalesJson contains flattened token map
- **WHEN** theme has scales `{ space: { 4: '0.25rem', 8: '0.5rem' }, colors: { primary: 'var(--colors-primary)' } }`
- **THEN** `tokens.evaluate().scalesJson` SHALL parse to `{ "space.4": "0.25rem", "space.8": "0.5rem", "colors.primary": "var(--colors-primary)" }`

#### Scenario: scalesJson includes breakpoints
- **WHEN** theme has `{ breakpoints: { xs: 480, sm: 768, md: 1024 } }`
- **THEN** `tokens.evaluate().scalesJson` SHALL parse to include `{ "breakpoints.xs": "480", "breakpoints.sm": "768", "breakpoints.md": "1024" }`
- **THEN** the Rust crate's `extract_breakpoints()` SHALL find all breakpoint entries and generate correct `@media (min-width: ...)` queries

#### Scenario: variableMapJson contains token-to-CSS-var mapping
- **WHEN** theme has a color scale where values are CSS variables (e.g., `primary: 'var(--colors-primary)'`)
- **THEN** `tokens.evaluate().variableMapJson` SHALL parse to a map including `{ "colors.primary": "--colors-primary" }`

#### Scenario: variableCss contains root and mode selector blocks
- **WHEN** theme has `_variables` (root CSS vars) and `_tokens.modes` (color mode overrides)
- **THEN** `tokens.evaluate().variableCss` SHALL contain a `:root { ... }` block with root variables AND `[data-color-mode="<name>"] { ... }` blocks for each mode

#### Scenario: contextualVarsJson contains contextual var registry
- **WHEN** theme was built with `.addContextualVars({ colors: ['background-current'] })`
- **THEN** `tokens.evaluate().contextualVarsJson` SHALL parse to `{ "colors": ["background-current"] }`

#### Scenario: contextualVarsJson empty when no contextual vars
- **WHEN** theme was built without `.addContextualVars()`
- **THEN** `tokens.evaluate().contextualVarsJson` SHALL be `"{}"`

#### Scenario: evaluate is non-enumerable
- **WHEN** consumer spreads the theme object `{ ...tokens }`
- **THEN** the spread SHALL NOT include an `evaluate` key

#### Scenario: evaluate produces identical output to vite-plugin evaluateThemeObject
- **WHEN** `tokens.evaluate()` is called on the same theme object that `evaluateThemeObject(tokens)` from vite-plugin would process
- **THEN** all 4 returned strings SHALL be byte-identical

### Requirement: Pipeline subpath export
The `@animus-ui/system/pipeline` subpath SHALL export pipeline utilities for build tooling authors.

#### Scenario: resolveGlobalStyles exported
- **WHEN** build tooling imports `resolveGlobalStyles` from `@animus-ui/system/pipeline`
- **THEN** it SHALL receive a function that resolves global style objects to CSS strings using propConfig, flat theme, and transform functions

#### Scenario: resolveGlobalStyles produces CSS from global style objects
- **WHEN** `resolveGlobalStyles({ 'html, body': { bg: 'background', color: 'text' } }, propConfigJson, flatTheme, transforms)` is called
- **THEN** the result SHALL be a CSS string with resolved property names (`background` not `bg`) and resolved scale values (theme token lookup applied)

#### Scenario: resolveGlobalStyles applies transforms
- **WHEN** a global style property has an associated transform function (e.g., `size` transform on `width`)
- **THEN** the resolved CSS SHALL use the transformed value, not the raw input

#### Scenario: EvaluatedTheme type exported
- **WHEN** build tooling imports `EvaluatedTheme` from `@animus-ui/system/pipeline`
- **THEN** it SHALL receive the type `{ scalesJson: string; variableMapJson: string; variableCss: string; contextualVarsJson: string }`
