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
