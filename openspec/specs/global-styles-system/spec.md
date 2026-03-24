### Requirement: withGlobalStyles method on SystemBuilder
The `SystemBuilder` class SHALL expose a `.withGlobalStyles(styles)` method that accepts a compound object with optional `reset` and `global` keys. Each key maps to a CSS-selector-keyed object where values are style objects using the same prop shorthand as component `.styles()` blocks. The method SHALL return a new `SystemBuilder` instance preserving all previously configured tokens, properties, and groups.

#### Scenario: Compound shape with reset and global
- **WHEN** `.withGlobalStyles({ reset: { '*, *::before, *::after': { boxSizing: 'border-box' } }, global: { 'html, body': { bg: 'background' } } })` is called
- **THEN** the builder SHALL store both reset and global style maps and the built system instance SHALL include them in `serialize()` output

#### Scenario: Reset only
- **WHEN** `.withGlobalStyles({ reset: { body: { m: 0 } } })` is called without a `global` key
- **THEN** the builder SHALL store the reset styles and emit them in `@layer global`

#### Scenario: Global only
- **WHEN** `.withGlobalStyles({ global: { '::selection': { bg: 'primary' } } })` is called without a `reset` key
- **THEN** the builder SHALL store the global styles and emit them in `@layer global`

#### Scenario: Chaining after withProperties
- **WHEN** `.withTokens(...)` then `.withProperties(...)` then `.withGlobalStyles(...)` then `.build()` is called
- **THEN** the system SHALL build successfully with all tokens, properties, and global styles available

#### Scenario: Prop shorthand in global styles
- **WHEN** a global style uses `{ p: 8, bg: 'background', border: 1 }`
- **THEN** the style object SHALL be stored as-is (resolution happens during extraction, not during system construction)

### Requirement: Global styles in SerializedConfig
The `SerializedConfig` interface SHALL include an optional `globalStyles` field of type `{ reset?: Record<string, Record<string, any>>; global?: Record<string, Record<string, any>> }` containing the compound style configuration.

#### Scenario: serialize() includes globalStyles
- **WHEN** `ds.serialize()` is called on a system with `.withGlobalStyles()` configured
- **THEN** the returned object SHALL include a `globalStyles` field containing the compound object with `reset` and/or `global` keys

#### Scenario: serialize() without globalStyles
- **WHEN** `ds.serialize()` is called on a system without `.withGlobalStyles()`
- **THEN** the returned object SHALL NOT include a `globalStyles` field (or it SHALL be undefined)

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
Both `reset` and `global` style blocks SHALL be resolved and emitted together inside `@layer global { }` in the virtual stylesheet. Reset styles SHALL appear before global styles within the layer. The `@layer` declaration SHALL be `@layer global, base, variants, states, system, custom;`.

#### Scenario: Combined emission in @layer global
- **WHEN** the system has both reset and global styles
- **THEN** the virtual stylesheet content SHALL be: theme variable CSS, then `@layer global { reset CSS + global CSS }`, then `@layer global, base, variants, states, system, custom;` declaration, then component CSS

#### Scenario: Complex selectors preserved
- **WHEN** global styles include `'body::after'`, `'::-webkit-scrollbar'`, `'::selection'`
- **THEN** the emitted CSS SHALL use these selectors verbatim within `@layer global`

#### Scenario: No global styles configured
- **WHEN** the system has no `.withGlobalStyles()` call
- **THEN** the virtual stylesheet SHALL contain only theme variables and component CSS (no empty global block)

#### Scenario: @layer declaration includes global
- **WHEN** any extraction produces CSS
- **THEN** the CSS output SHALL begin with `@layer global, base, variants, states, system, custom;` to establish layer precedence

### Requirement: @keyframes support in global styles
Global style objects SHALL support `@keyframes` at-rule definitions as top-level keys in the `global` block. Keyframe blocks contain nested selectors (percentage stops) with their own property declarations and SHALL be serialized as raw CSS without prop config resolution — only camelCase → kebab-case conversion on property names.

#### Scenario: Keyframe definition in global styles
- **WHEN** global styles include `'@keyframes ember': { '0%, 100%': { textShadow: '...' }, '50%': { textShadow: '...' } }`
- **THEN** the emitted CSS SHALL contain a valid `@keyframes ember { 0%, 100% { text-shadow: ...; } 50% { text-shadow: ...; } }` block inside `@layer global`

#### Scenario: Keyframes bypass prop resolution
- **WHEN** an `@keyframes` block contains properties like `transform` or `textShadow`
- **THEN** values SHALL be emitted verbatim after camelToKebab conversion — no scale lookups, no transforms, no token resolution

#### Scenario: Keyframes coexist with regular selectors
- **WHEN** global styles contain both `@keyframes` definitions and regular CSS selectors
- **THEN** both SHALL be emitted inside `@layer global` — regular selectors go through full prop resolution, `@keyframes` blocks go through raw serialization

### Requirement: Global styles resolution via standalone subprocess
Global style resolution SHALL be performed by a standalone script (`resolve-global-styles.ts`) invoked via `bun run`, not by an inline-generated JavaScript string. The script SHALL receive the system module path, theme JSON path, and output file path as CLI arguments.

#### Scenario: Subprocess script invocation
- **WHEN** the Vite plugin resolves global styles at `buildStart`
- **THEN** it SHALL invoke `resolve-global-styles.ts` as a subprocess, passing the system path and a temporary theme JSON file

#### Scenario: Script resolution via candidate paths
- **WHEN** the plugin searches for `resolve-global-styles.ts`
- **THEN** it SHALL check `__pluginDir`, `__pluginDir/../src/`, and package.json-resolved paths — same pattern as `resolve-transforms.ts`
