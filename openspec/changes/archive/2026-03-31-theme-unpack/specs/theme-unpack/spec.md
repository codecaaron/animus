## ADDED Requirements

### Requirement: Built theme exposes unpack() method
A built theme object SHALL expose a non-enumerable `unpack()` method that returns an `UnpackedTheme` record containing the raw config pieces used to construct the theme.

#### Scenario: unpack() is present after build()
- **WHEN** a consumer calls `.build()` on a theme builder chain
- **THEN** the resulting object has an `unpack` property that is a function

#### Scenario: unpack() is non-enumerable
- **WHEN** a consumer calls `Object.keys(tokens)` or `JSON.stringify(tokens)` on a built theme
- **THEN** `unpack` does NOT appear in the output

---

### Requirement: unpack() returns raw colors config
`unpack()` SHALL return a `colors` field containing the original nested color config as passed to `addColors()`, not the flattened token map.

#### Scenario: Nested color structure is preserved
- **WHEN** a theme is built with `addColors({ gray: { 50: '#fafafa', 900: '#111' } })`
- **THEN** `unpack().colors` equals `{ gray: { 50: '#fafafa', 900: '#111' } }`

#### Scenario: Multiple addColors calls are merged
- **WHEN** a theme chain calls `addColors({ primary: 'blue' })` and then `addColors({ accent: 'purple' })`
- **THEN** `unpack().colors` contains both `primary` and `accent`

---

### Requirement: unpack() returns raw colorModes config
`unpack()` SHALL return a `colorModes` field containing the original mode alias maps and the default mode key.

#### Scenario: colorModes shape matches addColorModes input
- **WHEN** a theme is built with `addColorModes('dark', { dark: { bg: 'gray-900' }, light: { bg: 'gray-50' } })`
- **THEN** `unpack().colorModes.default` equals `'dark'`
- **THEN** `unpack().colorModes.modes` equals `{ dark: { bg: 'gray-900' }, light: { bg: 'gray-50' } }`

#### Scenario: colorModes is absent when not configured
- **WHEN** a theme is built without calling `addColorModes`
- **THEN** `unpack().colorModes` is `undefined`

---

### Requirement: unpack() returns raw per-scale configs
`unpack()` SHALL return a `scales` field containing one entry per `addScale` call, keyed by scale name, holding the original values config.

#### Scenario: Scale values are present under their name
- **WHEN** a theme is built with `addScale({ name: 'space', values: { 0: '0', 8: '0.5rem' } })`
- **THEN** `unpack().scales.space.values` equals `{ 0: '0', 8: '0.5rem' }`

#### Scenario: Multiple scales are all present
- **WHEN** a theme is built with both `addScale({ name: 'space', ... })` and `addScale({ name: 'fontSizes', ... })`
- **THEN** `unpack().scales` contains both `space` and `fontSizes` keys

#### Scenario: scales is empty when no addScale calls were made
- **WHEN** a theme is built without any `addScale` calls
- **THEN** `unpack().scales` is an empty object `{}`

---

### Requirement: unpack() returns raw breakpoints config
`unpack()` SHALL return a `breakpoints` field containing the original breakpoints object passed to `createTheme()`.

#### Scenario: Breakpoints match createTheme input
- **WHEN** a theme is built with `createTheme({ breakpoints: { sm: 640, md: 768, lg: 1024 } })`
- **THEN** `unpack().breakpoints` equals `{ sm: 640, md: 768, lg: 1024 }`

---

### Requirement: Unpacked pieces are directly spreadable into createTheme()
The values returned by `unpack()` SHALL be valid inputs to the corresponding `createTheme()` builder methods without transformation.

#### Scenario: Round-trip rebuild produces equivalent theme structure
- **WHEN** a theme is unpacked with `const parts = lib.unpack()`
- **AND** a new theme is built by spreading `parts.colors` into `addColors()`, each scale into `addScale()`, and `parts.colorModes` into `addColorModes()`
- **THEN** the rebuilt theme has the same token paths and CSS variable values as the original

#### Scenario: Consumer can augment colors after spreading
- **WHEN** a consumer does `addColors({ ...parts.colors, brand: { 500: '#custom' } })`
- **THEN** the resulting theme has all library colors plus the new `brand-500` token

#### Scenario: Consumer can omit a scale
- **WHEN** a consumer spreads some scales but omits `fontSizes`
- **THEN** the rebuilt theme has all other scales but no `fontSizes` tokens

---

### Requirement: UnpackedTheme type carries generic params
The `UnpackedTheme` type SHALL be parameterized so that each field has the exact TypeScript type corresponding to the original builder call arguments.

#### Scenario: colors field type matches addColors argument type
- **WHEN** TypeScript infers the type of `unpack().colors`
- **THEN** the type is the exact object shape passed to `addColors()`, not `Record<string, unknown>`

#### Scenario: UnpackedTheme is exported from system index
- **WHEN** a consumer imports from `@animus-ui/system`
- **THEN** `UnpackedTheme` is available as a named export
