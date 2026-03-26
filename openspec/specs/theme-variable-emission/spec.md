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

#### Scenario: All modes get explicit selectors
- **WHEN** the theme has color modes (e.g., 'dark' and 'light') defined via `addColorModes`
- **THEN** the extracted CSS SHALL contain a `[data-color-mode="X"]` block for EVERY mode, including the default/initial mode, AFTER the `:root` block
- **WHY** Explicit selectors for all modes enable nested color mode overrides — any element with `data-color-mode="dark"` will receive the correct variable values regardless of the page-level mode

#### Scenario: Only semantic overrides in mode selector
- **WHEN** a mode overrides 20 semantic tokens but there are 36 raw color definitions
- **THEN** each `[data-color-mode]` block SHALL contain ONLY the semantic overrides, NOT the raw color definitions (raw colors don't change between modes)

#### Scenario: Variables before @layer
- **WHEN** the extracted CSS output includes both variable definitions and component CSS
- **THEN** the variable definitions (`:root`, `[data-color-mode]`) SHALL appear BEFORE the `@layer base, variants, states, system, custom;` declaration

### Requirement: Theme evaluator extracts variables
The `evaluateTheme` function SHALL return both flattened scale JSON (for the Rust pipeline) AND a CSS string containing variable definitions (for prepending to extracted output).

#### Scenario: evaluateTheme return shape
- **WHEN** `evaluateTheme(ssrLoadModule, themePath)` is called with a theme module
- **THEN** it SHALL return `{ scalesJson: string, variableMapJson: string, variableCss: string }` where `scalesJson` is the flat `{ "scale.key": "value" }` JSON, `variableMapJson` maps token paths to CSS variable names, and `variableCss` is the `:root { ... } [data-color-mode="dark"] { ... } [data-color-mode="light"] { ... }` CSS string containing all mode selectors

#### Scenario: Theme without color modes
- **WHEN** the theme has no `addColorModes` call (no `_tokens.modes`)
- **THEN** `variableCss` SHALL contain only the `:root` block with all `_variables` entries, and no `[data-color-mode]` blocks
