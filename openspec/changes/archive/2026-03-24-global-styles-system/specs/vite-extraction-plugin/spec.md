## MODIFIED Requirements

### Requirement: CSS output includes theme variables
The virtual CSS module (`virtual:animus/styles.css`) SHALL prepend theme variable CSS (`:root` definitions and `[data-color-mode]` overrides), then resolved global CSS (if configured), before the component CSS when variable definitions are available.

#### Scenario: Virtual module with theme variables and global styles
- **WHEN** the plugin has theme variables, resolved global CSS, and extracted component CSS
- **THEN** the virtual CSS module content SHALL be `variableCss + globalCss + componentCss`

#### Scenario: Virtual module with theme variables only
- **WHEN** the plugin has theme variables and component CSS but no global styles
- **THEN** the virtual CSS module content SHALL be `variableCss + componentCss` (no empty global block)

#### Scenario: Virtual module without theme variables
- **WHEN** the plugin uses a pre-serialized JSON theme (no `_variables` available) and has no global styles
- **THEN** the virtual CSS module content SHALL contain only the component CSS

#### Scenario: Dev mode serves global CSS
- **WHEN** the plugin runs in dev mode with global styles configured
- **THEN** the virtual CSS module SHALL serve the resolved global CSS alongside theme variables and component styles
