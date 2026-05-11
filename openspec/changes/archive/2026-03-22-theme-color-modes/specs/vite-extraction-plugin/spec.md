## MODIFIED Requirements

### Requirement: Plugin factory function
The Vite plugin SHALL be exported as `animusExtract(options?) -> Plugin` from `@animus-ui/vite-plugin`. The `theme` option SHALL accept TWO forms: a pre-serialized flat JSON string (legacy, no CSS variable emission) or an object `{ scales: string; variables: string }` containing pre-evaluated scales JSON and CSS variable declarations. Theme evaluation (via `evaluateTheme` or other means) is the CALLER's responsibility.

#### Scenario: Default configuration
- **WHEN** `animusExtract()` is called with no options
- **THEN** the plugin SHALL use an empty theme JSON `'{}'` (no variable emission)

#### Scenario: Pre-serialized theme JSON (legacy)
- **WHEN** `animusExtract({ theme: '{"colors.primary": "#6366f1"}' })` is called with a JSON string
- **THEN** the plugin SHALL use it directly as the flattened theme with no CSS variable emission (backward compatible)

#### Scenario: Pre-evaluated theme with variables
- **WHEN** `animusExtract({ theme: { scales: '{"colors.primary": "var(--color-primary)"}', variables: ':root { --color-primary: #6366f1; }' } })` is called
- **THEN** the plugin SHALL use `scales` as the flattened theme for the Rust pipeline and `variables` as CSS to prepend to the virtual stylesheet

#### Scenario: Theme options parsed in both dev and build modes
- **WHEN** the plugin runs in dev mode (`command: 'serve'`)
- **THEN** theme and variable CSS SHALL still be parsed from options, so the virtual CSS module can serve variable definitions even without full extraction

### Requirement: CSS output includes theme variables
The virtual CSS module (`virtual:animus/styles.css`) SHALL prepend theme variable CSS (`:root` definitions and `[data-color-mode]` overrides) before the component CSS when variable definitions are available.

#### Scenario: Virtual module with theme variables
- **WHEN** the plugin has theme variables and extracted component CSS
- **THEN** the virtual CSS module content SHALL be `variableCss + '\n\n' + componentCss`

#### Scenario: Virtual module without theme variables
- **WHEN** the plugin uses a pre-serialized JSON theme (no `_variables` available)
- **THEN** the virtual CSS module content SHALL contain only the component CSS

#### Scenario: Dev mode serves variable CSS
- **WHEN** the plugin runs in dev mode with `theme: { scales, variables }` provided
- **THEN** the virtual CSS module SHALL serve the variable CSS even though component extraction is skipped
