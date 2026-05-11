## MODIFIED Requirements

### Requirement: Theme evaluation at build start
The plugin SHALL evaluate the theme module at `buildStart` using Vite's `ssrLoadModule()`. It SHALL flatten all theme scales into a JSON map of `{ "scale_name.key": "css_value" }` format AND build a variable-name map of `{ "token_path": "css_variable_name" }` from the theme's CSS variable declarations. Both maps SHALL be held in memory for passing to the Rust extraction functions.

#### Scenario: Theme with computed scales
- **WHEN** the theme uses `.addScale('shadows', ({ colors }) => ({...}))` with function-based scale definitions
- **THEN** the plugin SHALL evaluate the full theme build chain, resolving all function-based scales to their final values, and include them in the flattened JSON map

#### Scenario: Theme with color modes
- **WHEN** the theme uses `.addColorModes()` generating CSS custom properties
- **THEN** the flattened map SHALL contain CSS variable references (e.g., `"colors.background": "var(--colors-background)"`) rather than raw color values

#### Scenario: Variable-name map built from theme
- **WHEN** the theme has CSS variable declarations (from `.addColors()`, `.addColorModes()`, `.createScaleVariables()`)
- **THEN** the plugin SHALL build a variable-name map where each key is the token path (e.g., `"colors.primary"`) and each value is the CSS variable name (e.g., `"--colors-primary"`)

#### Scenario: Non-variable scales excluded from variable map
- **WHEN** a scale (e.g., `space`, `fontSizes`) does not emit CSS variables
- **THEN** tokens from that scale SHALL NOT appear in the variable-name map — they resolve to literal values via the flat map only

#### Scenario: Variable map passed to Rust functions
- **WHEN** the plugin calls `extract()` or `analyze_project()`
- **THEN** it SHALL pass the variable-name map JSON as an additional argument alongside the existing theme, config, and group registry JSON arguments
