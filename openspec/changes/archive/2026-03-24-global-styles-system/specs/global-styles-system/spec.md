## ADDED Requirements

### Requirement: withGlobalStyles method on SystemBuilder
The `SystemBuilder` class SHALL expose a `.withGlobalStyles(styles)` method that accepts an object keyed by CSS selectors, where each value is a style object using the same prop shorthand as component `.styles()` blocks. The method SHALL return a new `SystemBuilder` instance preserving all previously configured tokens, properties, and groups.

#### Scenario: Basic global styles
- **WHEN** `.withGlobalStyles({ 'html, body': { m: 0, bg: 'background', color: 'text' } })` is called
- **THEN** the builder SHALL store the global styles and the built system instance SHALL include them in `serialize()` output

#### Scenario: Chaining after withProperties
- **WHEN** `.withTokens(...)` then `.withProperties(...)` then `.withGlobalStyles(...)` then `.build()` is called
- **THEN** the system SHALL build successfully with all tokens, properties, and global styles available

#### Scenario: Multiple selectors
- **WHEN** `.withGlobalStyles({ '*, *::before, *::after': { boxSizing: 'border-box' }, a: { color: 'primary' }, '::selection': { bg: 'primary' } })` is called
- **THEN** all three selectors SHALL be preserved in the serialized output

#### Scenario: Prop shorthand in global styles
- **WHEN** a global style uses `{ p: 8, bg: 'background', border: 1 }`
- **THEN** the style object SHALL be stored as-is (resolution happens during extraction, not during system construction)

### Requirement: Global styles in SerializedConfig
The `SerializedConfig` interface SHALL include an optional `globalStyles` field of type `Record<string, Record<string, any>>` mapping CSS selectors to unresolved style objects.

#### Scenario: serialize() includes globalStyles
- **WHEN** `ds.serialize()` is called on a system with `.withGlobalStyles()` configured
- **THEN** the returned object SHALL include a `globalStyles` field containing the selector-keyed style objects

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

### Requirement: Global CSS emission in virtual stylesheet
Resolved global CSS SHALL be emitted in the virtual stylesheet (`virtual:animus/styles.css`) BEFORE the `@layer` declaration and component CSS. Global styles SHALL NOT be wrapped in any `@layer` block.

#### Scenario: Global CSS before layers
- **WHEN** the system has global styles and extracted component CSS
- **THEN** the virtual stylesheet content SHALL be: theme variable CSS, then global CSS, then `@layer` declaration, then component CSS

#### Scenario: Complex selectors preserved
- **WHEN** global styles include `'body::after'`, `'::-webkit-scrollbar'`, `'::selection'`
- **THEN** the emitted CSS SHALL use these selectors verbatim

#### Scenario: No global styles configured
- **WHEN** the system has no `.withGlobalStyles()` call
- **THEN** the virtual stylesheet SHALL contain only theme variables and component CSS (no empty global block)
