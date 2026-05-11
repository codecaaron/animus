## ADDED Requirements

### Requirement: ThemeManifest structure
The ThemeBuilder `.build()` method SHALL produce a `ThemeManifest` accessible via a `.manifest` property on the returned theme object. The manifest SHALL contain four fields: `tokenMap` (flat token key → raw value), `variableMap` (flat token key → CSS variable name without `var()` wrapper), `modes` (mode name → flat key → resolved value), and `variableCss` (pre-built CSS string).

#### Scenario: Manifest contains flat token map
- **WHEN** a theme has `addScale('space', () => ({ 8: '0.5rem', 16: '1rem' }))` and `addColors({ ember: '#FF2800' })`
- **THEN** `theme.manifest.tokenMap` SHALL contain `{ 'space.8': '0.5rem', 'space.16': '1rem', 'colors.ember': '#FF2800' }`

#### Scenario: Manifest contains variable map
- **WHEN** a theme has `addColors({ ember: '#FF2800' })` which emits CSS variable `--color-ember`
- **THEN** `theme.manifest.variableMap` SHALL contain `{ 'colors.ember': '--color-ember' }` (no `var()` wrapper)

#### Scenario: Manifest contains mode definitions
- **WHEN** a theme has `addColorModes('dark', { dark: { primary: 'ember' }, light: { primary: 'scorch' } })`
- **THEN** `theme.manifest.modes` SHALL contain `{ dark: { 'colors.primary': '#FF2800' }, light: { 'colors.primary': '#C1121F' } }` with resolved raw values

#### Scenario: Manifest contains pre-built variable CSS
- **WHEN** a theme has colors and color modes defined
- **THEN** `theme.manifest.variableCss` SHALL contain the complete CSS string with `:root { ... }` and `[data-color-mode="..."] { ... }` blocks

#### Scenario: Static scales excluded from variable map
- **WHEN** a theme has `addScale('space', () => ({ 8: '0.5rem' }))` (no CSS variable emission)
- **THEN** `theme.manifest.variableMap` SHALL NOT contain any entry for `space.8`
- **AND** `theme.manifest.tokenMap` SHALL contain `{ 'space.8': '0.5rem' }`

### Requirement: Manifest does not affect theme type
The `.manifest` property SHALL be non-enumerable on the returned theme object. The return type of `.build()` SHALL remain unchanged — `typeof tokens` SHALL produce the same type as before for module augmentation purposes.

#### Scenario: Spread excludes manifest
- **WHEN** a consumer spreads the theme object `{ ...tokens }`
- **THEN** the spread result SHALL NOT contain a `manifest` property

#### Scenario: Module augmentation unchanged
- **WHEN** a consumer writes `type ShowcaseTheme = typeof tokens; declare module '@animus-ui/system' { interface Theme extends ShowcaseTheme {} }`
- **THEN** the augmented Theme interface SHALL have the same shape as before this change

### Requirement: ThemeManifest type is opaque
The `ThemeManifest` interface SHALL use no generic type parameters. All fields SHALL use `Record<string, string>` or `Record<string, Record<string, string>>` — no literal key preservation.

#### Scenario: ThemeManifest type definition
- **WHEN** a consumer imports `ThemeManifest` from `@animus-ui/system`
- **THEN** the type SHALL be `{ tokenMap: Record<string, string>; variableMap: Record<string, string>; modes: Record<string, Record<string, string>>; variableCss: string }`

### Requirement: Color value validation
`addColors()` SHALL validate that all color values are valid CSS `<color>` values. Accepted formats: hex, rgb/rgba, hsl/hsla, oklch, oklab, lch, lab, named CSS colors, `transparent`, `currentColor`. Rejected: gradients, `inherit`, `initial`, `unset`, objects, arbitrary non-color strings.

#### Scenario: Valid hex color accepted
- **WHEN** `addColors({ primary: '#FF2800' })` is called
- **THEN** the color SHALL be accepted without error

#### Scenario: Valid oklch color accepted
- **WHEN** `addColors({ primary: 'oklch(0.7 0.15 30)' })` is called
- **THEN** the color SHALL be accepted without error

#### Scenario: transparent and currentColor accepted
- **WHEN** `addColors({ overlay: 'transparent', icon: 'currentColor' })` is called
- **THEN** both values SHALL be accepted without error

#### Scenario: Gradient rejected with descriptive error
- **WHEN** `addColors({ gradient: 'linear-gradient(90deg, red, blue)' })` is called
- **THEN** a build-time error SHALL be thrown with message containing the key name `'gradient'` and listing accepted formats

#### Scenario: Object value rejected
- **WHEN** `addColors({ bad: { nested: 'value' } })` is called
- **THEN** a build-time error SHALL be thrown

### Requirement: Color mode alias validation
`addColorModes()` SHALL validate that every alias value references a key that exists in the current flattened color palette.

#### Scenario: Valid alias accepted
- **WHEN** `addColors({ ember: '#FF2800' })` followed by `addColorModes('dark', { dark: { primary: 'ember' } })`
- **THEN** the alias SHALL be accepted without error

#### Scenario: Unknown alias rejected with available keys
- **WHEN** `addColors({ ember: '#FF2800' })` followed by `addColorModes('dark', { dark: { primary: 'nonexistent' } })`
- **THEN** a build-time error SHALL be thrown with message containing `'nonexistent'`, the mode name `'dark'`, the alias name `'primary'`, and a list of available color keys
