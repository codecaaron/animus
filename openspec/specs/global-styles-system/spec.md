### Requirement: Build returns system and globalStyles factory
`createSystem().build()` SHALL return an object with two properties: `system` (the Animus component authoring instance) and `createGlobalStyles` (a factory function for producing global style blocks).

#### Scenario: Destructured build result
- **WHEN** a consumer calls `createSystem().addGroup(...).build()`
- **THEN** the return value SHALL be `{ system: SystemInstance, createGlobalStyles: GlobalStylesFactory }`
- **AND** `system` SHALL be an Animus instance with `.styles()`, `.variant()`, and all component chain methods
- **AND** `createGlobalStyles` SHALL be a function that accepts a selector-to-styles map

#### Scenario: System instance has no global style methods
- **WHEN** a consumer accesses the `system` property from the build result
- **THEN** the instance SHALL NOT have a `withGlobalStyles` method
- **AND** the instance SHALL NOT carry any global style configuration

### Requirement: createGlobalStyles produces composable blocks
The `createGlobalStyles` factory SHALL accept a flat `Record<string, Record<string, any>>` mapping CSS selectors to style objects. Each call produces an independent global style block.

#### Scenario: Single global style block
- **WHEN** a consumer calls `createGlobalStyles({ 'html, body': { bg: 'bg', color: 'text' } })`
- **THEN** it SHALL produce a global style block with resolved prop shorthand and token values

#### Scenario: Multiple independent blocks
- **WHEN** a consumer calls `createGlobalStyles` multiple times with different selector maps
- **THEN** each call SHALL produce an independent block
- **AND** blocks SHALL NOT share state or interfere with each other

#### Scenario: Keyframes in global styles
- **WHEN** a consumer includes `@keyframes` selectors in a global style block
- **THEN** the factory SHALL support nested keyframe structures (selector → percentages → props)
- **AND** keyframe values SHALL resolve prop shorthand and token aliases

### Requirement: Global styles factory shares token vocabulary
The `createGlobalStyles` factory SHALL resolve prop shorthand, scale lookups, transforms, and token aliases using the prop registry and transform map from the system build that produced it.

#### Scenario: Prop shorthand resolution
- **WHEN** a global style block contains `{ bg: 'surface', p: 24 }`
- **THEN** `bg` SHALL resolve to `background-color` via the prop config
- **AND** `p` SHALL resolve to `padding` with scale lookup via the prop config

#### Scenario: Token alias resolution
- **WHEN** a global style block contains `{ boxShadow: '0 0 8px {colors.primary/40}' }`
- **THEN** the token alias SHALL resolve to `color-mix(in srgb, var(--color-primary) 40%, transparent)`

#### Scenario: Transform application
- **WHEN** a global style block uses a prop that has a named transform (e.g., `fluidSize`)
- **THEN** the transform SHALL be applied during resolution

### Requirement: GlobalStyleBlock branding and discovery
Each global style block produced by `createGlobalStyles` SHALL carry a `__brand: 'GlobalStyleBlock'` property for plugin discovery. The block SHALL also expose a `styles` property (the raw selector map) and a `serialize(propConfig, transforms)` method for resolution.

#### Scenario: Block shape
- **WHEN** `createGlobalStyles({ body: { m: 0 } })` is called
- **THEN** the returned object SHALL have `__brand === 'GlobalStyleBlock'`, `styles`, and `serialize`

#### Scenario: Brand-based discovery
- **WHEN** the Vite plugin loads the system module
- **THEN** it SHALL iterate named exports and identify global style blocks by checking `val.__brand === 'GlobalStyleBlock'`

### Requirement: Plugin discovers global styles from module exports
The Vite plugin SHALL discover global style blocks from named exports in the system module file, not from `serialize().globalStyles`.

#### Scenario: Export discovery
- **WHEN** the system module exports named variables created by `createGlobalStyles`
- **THEN** the plugin SHALL import these exports and resolve them via the existing subprocess pipeline

#### Scenario: No global styles exported
- **WHEN** the system module does not export any global style blocks
- **THEN** the plugin SHALL emit no `@layer global` content
- **AND** no error or warning SHALL be produced

### Requirement: Global style resolution
Global style objects SHALL be resolved using the same prop config, theme scales, transforms, and token alias logic as component styles. Each prop key SHALL be looked up in the prop config to determine the CSS property name, scale, and transform. Scale values SHALL be resolved against the flattened theme. Transforms SHALL be applied directly (not deferred as placeholders).

#### Scenario: Scale resolution in global styles
- **WHEN** global style has `{ p: 8 }` and theme has `space.8 → "0.5rem"`
- **THEN** the resolved CSS SHALL contain `padding: 0.5rem`

#### Scenario: Color resolution in global styles
- **WHEN** global style has `{ bg: 'background' }` and theme has `colors.background → "var(--color-background)"`
- **THEN** the resolved CSS SHALL contain `background-color: var(--color-background)`

#### Scenario: Transform application in global styles
- **WHEN** global style has `{ border: 1 }` and the `border` prop has a `borderShorthand` transform
- **THEN** the resolved CSS SHALL contain the transform result (e.g., `border: 1px solid currentColor`) with the transform applied directly, NOT as a `__TRANSFORM__` placeholder

#### Scenario: Pass-through CSS properties
- **WHEN** global style has `{ boxSizing: 'border-box', textDecoration: 'none' }` (no prop config entry)
- **THEN** the resolved CSS SHALL contain `box-sizing: border-box; text-decoration: none` (camelCase → kebab-case conversion, no scale lookup)

#### Scenario: Multi-property prop expansion
- **WHEN** global style has `{ px: 16 }` and config maps `px` to `paddingLeft` + `paddingRight`
- **THEN** the resolved CSS SHALL contain both `padding-left: 1rem; padding-right: 1rem`

### Requirement: Global CSS emission in @layer global
All global style blocks SHALL be resolved and emitted together inside `@layer global { }` in the virtual stylesheet. The `@layer` declaration SHALL be `@layer global, base, variants, compounds, states, system, custom;`.

#### Scenario: Combined emission in @layer global
- **WHEN** the system has one or more global style blocks
- **THEN** the virtual stylesheet content SHALL be: theme variable CSS, then `@layer global { resolved CSS from all blocks }`, then component CSS

#### Scenario: Complex selectors preserved
- **WHEN** global styles include `'body::after'`, `'::-webkit-scrollbar'`, `'::selection'`
- **THEN** the emitted CSS SHALL use these selectors verbatim within `@layer global`

#### Scenario: No global styles configured
- **WHEN** no global style blocks are exported from the system module
- **THEN** the virtual stylesheet SHALL contain only theme variables and component CSS (no empty global block)

#### Scenario: @layer declaration includes global
- **WHEN** any extraction produces CSS
- **THEN** the CSS output SHALL begin with `@layer global, base, variants, compounds, states, system, custom;` to establish layer precedence

### Requirement: @keyframes support in global styles
Global style blocks SHALL support `@keyframes` at-rule definitions as top-level keys. Keyframe blocks contain nested selectors (percentage stops) with their own property declarations. Keyframe frame values SHALL resolve prop shorthand and token aliases.

#### Scenario: Keyframe definition in global styles
- **WHEN** global styles include `'@keyframes ember': { '0%, 100%': { textShadow: '...' }, '50%': { textShadow: '...' } }`
- **THEN** the emitted CSS SHALL contain a valid `@keyframes ember { 0%, 100% { text-shadow: ...; } 50% { text-shadow: ...; } }` block inside `@layer global`

#### Scenario: Keyframes coexist with regular selectors
- **WHEN** global styles contain both `@keyframes` definitions and regular CSS selectors
- **THEN** both SHALL be emitted inside `@layer global` — regular selectors go through full prop resolution, `@keyframes` blocks go through their own resolution path

### Requirement: Global styles resolution via standalone subprocess
Global style resolution SHALL be performed by a standalone script (`resolve-global-styles.ts`) invoked via `bun run`, not by an inline-generated JavaScript string. The script SHALL receive the system module path, theme JSON path, and output file path as CLI arguments.

#### Scenario: Subprocess script invocation
- **WHEN** the Vite plugin resolves global styles at `buildStart`
- **THEN** it SHALL invoke `resolve-global-styles.ts` as a subprocess, passing the system path and a temporary theme JSON file

#### Scenario: Script resolution via candidate paths
- **WHEN** the plugin searches for `resolve-global-styles.ts`
- **THEN** it SHALL check `__pluginDir`, `__pluginDir/../src/`, and package.json-resolved paths — same pattern as `resolve-transforms.ts`
