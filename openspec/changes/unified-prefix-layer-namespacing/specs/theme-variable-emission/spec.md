## MODIFIED Requirements

### Requirement: CSS variable definition emission
The Vite plugin SHALL emit CSS custom property definitions derived from the theme's manifest. Variable definitions SHALL appear BEFORE the `@layer` declaration. CSS variable names SHALL use dash-join format regardless of internal dot-path storage. When a `prefix` is configured, the `@layer` declaration line in the emitted CSS SHALL use prefixed layer names with dot-notation sublayers.

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

#### Scenario: Prefixed layer declaration after variables
- **WHEN** `prefix` is set to `'acme'` and the extracted CSS includes variable definitions
- **THEN** the variable definitions SHALL appear first (unprefixed `:root {}` blocks), followed by `@layer acme.global, acme.base, ...;`

#### Scenario: Variables are prefixed when prefix is set
- **WHEN** `prefix` is set to `'acme'` and the theme has colors `{ gray: { 50: '#fafafa' } }`
- **THEN** the extracted CSS SHALL contain `:root { --acme-color-gray-50: #fafafa; }` (existing behavior from `applyPrefix`)
