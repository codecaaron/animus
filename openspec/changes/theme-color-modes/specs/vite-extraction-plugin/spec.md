## MODIFIED Requirements

### Requirement: Plugin factory function
The Vite plugin SHALL be exported as `animusExtract(options?) -> Plugin` from `@animus-ui/vite-plugin`. The options object MAY include `theme` (path to theme module, default auto-detected), `config` (path to prop config module, default `@animus-ui/core/config`), and `include`/`exclude` globs for file filtering. The plugin SHALL accept EITHER a pre-serialized theme JSON string OR a path to a theme module for `ssrLoadModule`-based evaluation.

#### Scenario: Default configuration
- **WHEN** `animusExtract()` is called with no options
- **THEN** the plugin SHALL auto-detect the theme module by searching for `theme.ts` or `theme.js` in the project root and src directory

#### Scenario: Custom theme path
- **WHEN** `animusExtract({ theme: './src/design/theme.ts' })` is called
- **THEN** the plugin SHALL use the specified path for theme evaluation

#### Scenario: Pre-serialized theme JSON
- **WHEN** `animusExtract({ theme: '{"colors.primary": "var(--color-primary)"}' })` is called with a JSON string
- **THEN** the plugin SHALL use it directly as the flattened theme without `ssrLoadModule` evaluation (backward compatibility)

#### Scenario: ssrLoadModule theme evaluation
- **WHEN** `animusExtract({ theme: './theme.ts' })` is called with a file path
- **THEN** the plugin SHALL use `ssrLoadModule` to evaluate the theme at `buildStart`, extracting both flattened scales and CSS variable definitions

### Requirement: CSS output includes theme variables
The virtual CSS module (`virtual:animus/styles.css`) SHALL prepend theme variable CSS (`:root` definitions and `[data-color-mode]` overrides) before the component CSS when variable definitions are available.

#### Scenario: Virtual module with theme variables
- **WHEN** the plugin has evaluated a theme with `_variables` and the extracted CSS is served
- **THEN** the virtual CSS module content SHALL be `variableCss + '\n' + componentCss`

#### Scenario: Virtual module without theme variables
- **WHEN** the plugin uses a pre-serialized JSON theme (no `_variables` available)
- **THEN** the virtual CSS module content SHALL contain only the component CSS (backward compatible)
