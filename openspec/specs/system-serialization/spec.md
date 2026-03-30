## ADDED Requirements

### Requirement: System instance exposes serialize method
The SystemInstance SHALL expose a `.serialize()` method that returns all configuration the Vite plugin needs in a single call: tokens, prop config, group registry, and transform registry.

#### Scenario: Serialize produces complete plugin config
- **WHEN** consumer calls `ds.serialize()`
- **THEN** the return value SHALL contain `{ tokens, propConfig, groupRegistry, transforms }` where tokens is the built theme object, propConfig is the serialized prop definitions, groupRegistry maps group names to prop name arrays, and transforms maps transform names to transform functions

#### Scenario: Transforms collected from prop definitions
- **WHEN** prop groups contain props with `transform: createTransform('size', fn)`
- **THEN** `ds.serialize().transforms` SHALL include `{ size: fn }` extracted by walking all prop definitions in all groups

#### Scenario: Custom transforms collected
- **WHEN** a custom group contains `{ elevation: { property: 'boxShadow', transform: createTransform('elevation', fn) } }`
- **THEN** `ds.serialize().transforms` SHALL include `{ elevation: fn }` alongside default transforms

### Requirement: System instance exposes tokens
The SystemInstance SHALL expose a `.tokens` property containing the resolved token object (the return value of the ThemeBuilder).

#### Scenario: Token access for CSS variable emission
- **WHEN** consumer accesses `ds.tokens`
- **THEN** the value SHALL be the same object returned by the ThemeBuilder's `.build()` in the `.withTokens()` callback

### Requirement: Inline MapScale serialization
When a prop's `scale` is a `Record<string, string | number>` (an inline object map rather than a reference to a named scale), the serialized prop entry SHALL include the full scale object as JSON rather than a scale name string.

#### Scenario: Inline map scale in prop config
- **WHEN** a prop definition uses `scale: { sm: '0.5rem', md: '1rem', lg: '2rem' }` (an inline object)
- **THEN** `ds.serialize().propConfig` SHALL include the prop entry with `scale` serialized as the JSON representation of that object, not as a string name

#### Scenario: Named scale reference unchanged
- **WHEN** a prop definition uses `scale: 'spacing'` (a reference to a named scale)
- **THEN** `ds.serialize().propConfig` SHALL include the prop entry with `scale` as the string `'spacing'` — no change from prior behavior

### Requirement: Inline ArrayScale serialization
When a prop's `scale` is an array of values, the serialized prop entry SHALL include the full array as JSON rather than a scale name string.

#### Scenario: Inline array scale in prop config
- **WHEN** a prop definition uses `scale: [0, 4, 8, 16, 32]` (an inline array)
- **THEN** `ds.serialize().propConfig` SHALL include the prop entry with `scale` serialized as the JSON representation of that array

#### Scenario: Mixed scale types round-trip correctly
- **WHEN** a system contains props with named scales, inline map scales, and inline array scales
- **THEN** each prop in `ds.serialize().propConfig` SHALL serialize its `scale` in the correct form for its type — string for named, JSON object for map, JSON array for array

### Requirement: Negative flag in serialized prop entries
When a prop definition includes `negative: true`, the serialized prop entry SHALL include the `negative` flag. When absent or `false`, the flag SHALL be omitted from the serialized output.

#### Scenario: Negative flag present on prop
- **WHEN** a prop definition includes `negative: true` (e.g., a margin prop allowing negative values)
- **THEN** `ds.serialize().propConfig` SHALL include `negative: true` in that prop's serialized entry

#### Scenario: Negative flag absent on prop
- **WHEN** a prop definition does not include `negative` or sets `negative: false`
- **THEN** `ds.serialize().propConfig` SHALL NOT include a `negative` key in that prop's serialized entry

### Requirement: Theme self-serialization method naming
The built theme object's pipeline serialization method SHALL be named `.serialize()` (not `.evaluate()`), matching `ds.serialize()`.

#### Scenario: tokens.serialize() returns pipeline-ready JSON
- **WHEN** consumer calls `tokens.serialize()` on a theme built via `createTheme().build()`
- **THEN** the return value SHALL contain `{ scalesJson, variableMapJson, variableCss, contextualVarsJson }`

#### Scenario: tokens.evaluate() removed
- **WHEN** consumer accesses `tokens.evaluate`
- **THEN** it SHALL be `undefined` — the method is renamed, not aliased

### Requirement: SerializedTheme type naming
The type for the theme serialization return value SHALL be `SerializedTheme` (not `EvaluatedTheme`).

#### Scenario: SerializedTheme exported from system
- **WHEN** build tooling imports `SerializedTheme` from `@animus-ui/system`
- **THEN** it SHALL receive the type `{ scalesJson: string; variableMapJson: string; variableCss: string; contextualVarsJson: string }`
