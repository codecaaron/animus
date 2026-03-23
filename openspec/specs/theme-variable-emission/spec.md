## ADDED Requirements

### Requirement: CSS variable definition emission
The Vite plugin SHALL emit CSS custom property definitions derived from the theme's `_variables` structure as part of the extracted CSS output. Variable definitions SHALL appear BEFORE the `@layer` declaration and component CSS.

#### Scenario: Root variable definitions
- **WHEN** the theme has `_variables.root` containing `{ '--color-navy-500': '#282a36', '--color-white': '#FFFFFF' }`
- **THEN** the extracted CSS SHALL contain `:root { --color-navy-500: #282a36; --color-white: #FFFFFF; }` before any `@layer` declarations

#### Scenario: Mode variable definitions (default mode)
- **WHEN** the theme has `_variables.mode` containing `{ '--color-primary': 'var(--color-purple-700)' }` (from the initial/default color mode)
- **THEN** the extracted CSS SHALL contain these definitions within the `:root` block alongside raw color definitions

#### Scenario: Scale variable definitions
- **WHEN** the theme has `_variables.shadows` containing `{ '--shadows-logo': '0.1em calc(0.07em * -1) ...' }`
- **THEN** the extracted CSS SHALL contain these definitions within the `:root` block

#### Scenario: Dark mode variable overrides
- **WHEN** the theme has color modes with a 'dark' mode that maps `primary` to a different raw color than the default mode
- **THEN** the extracted CSS SHALL contain a `[data-color-mode="dark"] { --color-primary: var(--color-{dark-value}); }` block AFTER the `:root` block

#### Scenario: Only semantic overrides in mode selector
- **WHEN** dark mode overrides 20 semantic tokens but there are 36 raw color definitions
- **THEN** the `[data-color-mode="dark"]` block SHALL contain ONLY the semantic overrides, NOT the raw color definitions (raw colors don't change between modes)

#### Scenario: Variables before @layer
- **WHEN** the extracted CSS output includes both variable definitions and component CSS
- **THEN** the variable definitions (`:root`, `[data-color-mode]`) SHALL appear BEFORE the `@layer base, variants, states, system, custom;` declaration

### Requirement: Theme evaluator extracts variables
The `evaluateTheme` function SHALL return both flattened scale JSON (for the Rust pipeline) AND a CSS string containing variable definitions (for prepending to extracted output).

#### Scenario: evaluateTheme return shape
- **WHEN** `evaluateTheme(ssrLoadModule, themePath)` is called with a theme module
- **THEN** it SHALL return `{ scalesJson: string, variableCss: string }` where `scalesJson` is the flat `{ "scale.key": "value" }` JSON and `variableCss` is the `:root { ... } [data-color-mode="dark"] { ... }` CSS string

#### Scenario: Theme without color modes
- **WHEN** the theme has no `addColorModes` call (no `_tokens.modes`)
- **THEN** `variableCss` SHALL contain only the `:root` block with all `_variables` entries, and no `[data-color-mode]` blocks
