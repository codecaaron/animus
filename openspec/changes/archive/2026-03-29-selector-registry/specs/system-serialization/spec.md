## MODIFIED Requirements

### Requirement: System instance exposes serialize method
The SystemInstance SHALL expose a `.serialize()` method that returns all configuration the Vite plugin needs in a single call: tokens, prop config, group registry, transform registry, and selector registry.

#### Scenario: Serialize produces complete plugin config
- **WHEN** consumer calls `ds.serialize()`
- **THEN** the return value SHALL contain `{ tokens, propConfig, groupRegistry, transforms, selectors }` where tokens is the built theme object, propConfig is the serialized prop definitions, groupRegistry maps group names to prop name arrays, transforms maps transform names to transform functions, and selectors maps shorthand names to CSS attribute selector strings

#### Scenario: Transforms collected from prop definitions
- **WHEN** prop groups contain props with `transform: createTransform('size', fn)`
- **THEN** `ds.serialize().transforms` SHALL include `{ size: fn }` extracted by walking all prop definitions in all groups

#### Scenario: Custom transforms collected
- **WHEN** a custom group contains `{ elevation: { property: 'boxShadow', transform: createTransform('elevation', fn) } }`
- **THEN** `ds.serialize().transforms` SHALL include `{ elevation: fn }` alongside default transforms

#### Scenario: Selectors included in serialization
- **WHEN** consumer has called `.withSelectors({ open: '[data-state="open"]', disabled: '[disabled]' })`
- **THEN** `ds.serialize().selectors` SHALL be `{ open: '[data-state="open"]', disabled: '[disabled]' }`

#### Scenario: No selectors registered
- **WHEN** consumer has not called `.withSelectors()`
- **THEN** `ds.serialize().selectors` SHALL be `undefined` or omitted
