## ADDED Requirements

### Requirement: from() composition entry point

The ThemeBuilder SHALL provide a `.from(builtTheme)` method that seeds the builder with a built theme's raw config and advances the type-state to allow all augmentation methods.

#### Scenario: from() loads library theme

- **WHEN** consumer calls `createTheme().from(libTokens)`
- **THEN** the builder SHALL contain all of libTokens' breakpoints, colors, modes, and scales

#### Scenario: from() enables augmentation

- **WHEN** consumer calls `createTheme().from(libTokens).addColors({ brand: { 500: '#new' } })`
- **THEN** the builder SHALL deep-merge the new colors on top of the library's colors

#### Scenario: from() enables selective override

- **WHEN** consumer calls `createTheme().from(libTokens).addScale({ name: 'space', values: { 0: '0', 4: '0.25rem' } })`
- **THEN** the consumer's space scale SHALL replace the library's space scale entirely

#### Scenario: from() preserves all library config

- **WHEN** consumer calls `createTheme().from(libTokens).build()` with no augmentation
- **THEN** `theme.serialize()` output SHALL be identical to `libTokens.serialize()` output

### Requirement: Deep merge semantics on augmentation

When `add*` methods are called after `.from()` or after a prior `add*` call for the same piece, the inputs SHALL deep-merge with consumer values taking precedence.

#### Scenario: addColors deep merges

- **WHEN** library has `{ gray: { 50: '#fafafa', 100: '#f0f0f0' } }` and consumer calls `.addColors({ gray: { 50: '#ffffff' } })`
- **THEN** the result SHALL be `{ gray: { 50: '#ffffff', 100: '#f0f0f0' } }` — consumer wins on conflict, library preserved on non-conflict

#### Scenario: addScale replaces by name

- **WHEN** library has scale `space` and consumer adds scale `space` with different values
- **THEN** the consumer's scale SHALL replace the library's (scale-level replacement, not deep merge of values)

#### Scenario: addColorModes merges modes

- **WHEN** library has modes `dark` and `light` and consumer adds mode `custom`
- **THEN** the result SHALL have all three modes

### Requirement: Round-trip fidelity

A theme built from `.from(libTokens)` with no augmentation SHALL produce identical serialization output.

#### Scenario: Full round-trip

- **WHEN** consumer builds `createTheme().from(libTokens).build()`
- **THEN** `serialize()` output SHALL match `libTokens.serialize()`

### Requirement: Selective composition via spreading

Consumers MAY also compose by spreading individual properties into builder methods as an alternative to `.from()`.

#### Scenario: Spread colors only

- **WHEN** consumer calls `.addColors({ ...libTokens.colors })` without using `.from()`
- **THEN** the consumer theme SHALL have only the library's colors, no other library config

#### Scenario: Spread breakpoints and augment

- **WHEN** consumer calls `.addBreakpoints({ ...libTokens.breakpoints, xl: 1440 })`
- **THEN** the consumer theme SHALL have all library breakpoints plus `xl`
