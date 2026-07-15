## Purpose

Requirements for the `nested-theme-representation` capability: Nested color storage; Nested scale storage; Nested color mode storage; and 8 more.

## Requirements

### Requirement: Nested color storage

The ThemeBuilder SHALL store colors in their original nested structure as passed to `addColors()`. The builder SHALL NOT flatten nested color objects at storage time.

#### Scenario: Nested color object preserved

- **WHEN** consumer calls `.addColors({ gray: { 50: '#fafafa', 100: '#f0f0f0' } })`
- **THEN** `#theme.colors` SHALL contain `{ gray: { 50: '#fafafa', 100: '#f0f0f0' } }`

#### Scenario: Flat color entries preserved as-is

- **WHEN** consumer calls `.addColors({ ember: '#ff2800', bone: '#e8e0d0' })`
- **THEN** `#theme.colors` SHALL contain `{ ember: '#ff2800', bone: '#e8e0d0' }`

#### Scenario: Multiple addColors calls deep-merge

- **WHEN** consumer calls `.addColors({ gray: { 50: '#fafafa' } })` then `.addColors({ brand: { 500: '#ff0000' } })`
- **THEN** `#theme.colors` SHALL contain `{ gray: { 50: '#fafafa' }, brand: { 500: '#ff0000' } }`

### Requirement: Nested scale storage

The ThemeBuilder SHALL store scale values in their original structure as passed to `addScale()`.

#### Scenario: Scale values preserved

- **WHEN** consumer calls `.addScale({ name: 'space', values: { 0: '0', 8: '0.5rem' } })`
- **THEN** `#theme.space` SHALL contain `{ 0: '0', 8: '0.5rem' }`

#### Scenario: Nested scale values preserved

- **WHEN** consumer calls `.addScale({ name: 'test', values: { nested: { a: '1px', b: '2px' } } })`
- **THEN** `#theme.test` SHALL contain `{ nested: { a: '1px', b: '2px' } }`

### Requirement: Nested color mode storage

The ThemeBuilder SHALL store color mode configurations in their original nested structure. Mode aliases SHALL use dot-path notation to reference color keys.

#### Scenario: Mode alias uses dot-path

- **WHEN** consumer calls `.addColorModes('dark', { dark: { muted: 'gray.50', primary: 'ember' } })`
- **THEN** the mode config SHALL be stored with dot-path aliases and validated by walking the nested color structure

#### Scenario: Nested mode alias preserved

- **WHEN** consumer calls `.addColorModes('dark', { dark: { primary: { _: 'ember', hover: 'fire.600' } } })`
- **THEN** the mode config SHALL preserve the nesting `{ primary: { _: 'ember', hover: 'fire.600' } }`

#### Scenario: Mode alias validation walks nested colors

- **WHEN** consumer calls `.addColorModes('dark', { dark: { muted: 'gray.50' } })` and colors has `{ gray: { 50: '#fafafa' } }`
- **THEN** validation SHALL pass — `gray.50` resolves to `theme.colors.gray['50']`

#### Scenario: Invalid mode alias rejected

- **WHEN** consumer calls `.addColorModes('dark', { dark: { muted: 'nonexistent.key' } })`
- **THEN** the builder SHALL throw an error referencing the unknown color path

### Requirement: Dot-path as internal path separator

All user-facing references to nested token keys SHALL use dot-path notation (`.`). The dash-join format (`-`) SHALL exist only at the CSS serialization boundary.

#### Scenario: Token ref syntax uses dot-path

- **WHEN** consumer writes `.addScale({ name: 'shadows', values: { glow: '0 0 12px {colors.gray.50}' } })`
- **THEN** the token ref `{colors.gray.50}` SHALL resolve by walking `theme.colors.gray['50']`

#### Scenario: CSS variable names use dash-join

- **WHEN** theme has nested colors `{ gray: { 50: '#fafafa' } }` and `build()` runs
- **THEN** the emitted CSS variable SHALL be `--color-gray-50` (dot→dash at serialization boundary)

#### Scenario: manifest.tokenMap uses dot-path keys

- **WHEN** theme is built with nested colors
- **THEN** `manifest.tokenMap` keys SHALL use dot-path: `'colors.gray.50'`

#### Scenario: LiteralPaths uses dot separator

- **WHEN** TypeScript computes `LiteralPaths<T['colors'], '.'>`
- **THEN** the result SHALL be `'gray.50' | 'gray.100' | 'ember' | ...` (dot-path keys)

### Requirement: addBreakpoints method

`createTheme()` SHALL accept no arguments. Breakpoints SHALL be added via `.addBreakpoints()`.

#### Scenario: Zero-arg construction

- **WHEN** consumer calls `createTheme()`
- **THEN** the builder SHALL return a ThemeBuilder in empty state

#### Scenario: addBreakpoints stores breakpoints

- **WHEN** consumer calls `.addBreakpoints({ sm: 768, lg: 1200 })`
- **THEN** `#theme.breakpoints` SHALL contain `{ sm: 768, lg: 1200 }`

#### Scenario: Breakpoint validation

- **WHEN** consumer calls `.addBreakpoints({ sm: -1 })`
- **THEN** the builder SHALL throw an error

### Requirement: Type-state chain ordering

The ThemeBuilder SHALL enforce method ordering via type narrowing. Methods that depend on prior state SHALL only be available after their dependencies are satisfied.

#### Scenario: addColorModes requires colors

- **WHEN** consumer calls `createTheme().addBreakpoints({...}).addColorModes('dark', {...})`
- **THEN** TypeScript SHALL produce an error — `addColorModes` is not available until after `addColors`

#### Scenario: addScale available after colors

- **WHEN** consumer calls `createTheme().addBreakpoints({...}).addColors({...}).addScale({...})`
- **THEN** the chain SHALL compile — `addScale` is available after colors

#### Scenario: Later methods still available after earlier ones

- **WHEN** consumer calls `.addScale({...}).addColors({...})` (colors after scale)
- **THEN** TypeScript SHALL allow this — `addColors` augments the existing state

#### Scenario: from() relaxes ordering

- **WHEN** consumer calls `createTheme().from(libTokens).addScale({...})`
- **THEN** the chain SHALL compile — `.from()` advances to a state where all methods are available

### Requirement: Build-time flattening

`build()` SHALL flatten nested theme data into structures required by `serialize()` and `assembleManifest()`. No flattening SHALL occur before `build()`.

#### Scenario: Flat token map produced at build time

- **WHEN** consumer calls `.addColors({ gray: { 50: '#fafafa' } }).build()`
- **THEN** `theme.manifest.tokenMap` SHALL contain `{ 'colors.gray.50': 'var(--color-gray-50)' }`

#### Scenario: CSS variables use dash-join names

- **WHEN** consumer calls `.addColors({ ember: '#ff2800' }).build()`
- **THEN** `theme.manifest.variableCss` SHALL contain `--color-ember: #ff2800`

#### Scenario: Token refs resolved at build time via nested traversal

- **WHEN** theme has `{colors.ember}` in a scale value
- **THEN** `build()` SHALL resolve it by walking nested structure and substituting the resolved value

#### Scenario: serialize() output format unchanged

- **WHEN** a theme equivalent to the current showcase theme is built
- **THEN** `serialize()` SHALL produce identical `scalesJson`, `variableMapJson`, `variableCss`, and `contextualVarsJson` (modulo dot-path key format in scalesJson)

### Requirement: Built theme exposes nested data

The built theme SHALL expose raw nested config as enumerable properties and boundary methods as non-enumerable.

#### Scenario: Colors are nested after build

- **WHEN** consumer accesses `theme.colors`
- **THEN** the value SHALL be the original nested color map

#### Scenario: manifest is non-enumerable

- **WHEN** consumer calls `Object.keys(theme)`
- **THEN** `manifest`, `serialize`, and `varRef` SHALL NOT appear

### Requirement: varRef accessor

The built theme SHALL provide a non-enumerable `varRef(tokenPath)` method.

#### Scenario: varRef for emitted color

- **WHEN** consumer calls `theme.varRef('colors.gray.50')`
- **THEN** the return value SHALL be `'var(--color-gray-50)'`

#### Scenario: varRef for non-emitted scale

- **WHEN** consumer calls `theme.varRef('space.8')`
- **THEN** the return value SHALL be `'0.5rem'`

#### Scenario: varRef is non-enumerable

- **WHEN** consumer spreads the theme `{ ...theme }`
- **THEN** `varRef` SHALL NOT be in the spread result

### Requirement: Private theme fields removed

The built theme SHALL NOT expose `_variables`, `_tokens`, or `_getColorValue`.

#### Scenario: \_variables not on theme

- **WHEN** consumer accesses `theme._variables`
- **THEN** the value SHALL be `undefined`

#### Scenario: Pipeline data via manifest and serialize

- **WHEN** the plugin needs flat token maps and CSS variable blocks
- **THEN** it SHALL access them through `theme.manifest` and `theme.serialize()`

### Requirement: Terminology changes

The ThemeBuilder SHALL use updated method names for clarity and cross-builder consistency.

#### Scenario: declareContextualVars

- **WHEN** consumer declares phantom contextual variables
- **THEN** the method SHALL be `.declareContextualVars()` (not `addContextualVars`)

#### Scenario: extendScale

- **WHEN** consumer extends an existing scale with computed values
- **THEN** the method SHALL be `.extendScale(key, fn)` (not `updateScale`)

#### Scenario: ds.toConfig()

- **WHEN** the system instance serializes for the plugin
- **THEN** the method SHALL be `ds.toConfig()` (not `ds.serialize()`) to disambiguate from `tokens.serialize()`
