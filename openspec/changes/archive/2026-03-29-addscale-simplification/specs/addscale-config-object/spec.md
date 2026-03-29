## ADDED Requirements

### Requirement: addScale accepts a config object

`ThemeBuilder.addScale()` SHALL accept a single config object with the shape `{ name: string, values: Record<string | number, string | number>, emit?: boolean }`.

#### Scenario: Basic scale without emission

- **WHEN** `addScale({ name: 'space', values: { 0: '0', 8: '0.5rem', 16: '1rem' } })` is called
- **THEN** the theme SHALL contain `space` with the flattened values
- **THEN** no CSS variables SHALL be generated for the scale

#### Scenario: Scale with emission

- **WHEN** `addScale({ name: 'sizes', emit: true, values: { navHeight: '48px' } })` is called
- **THEN** the theme SHALL contain `sizes` with values converted to `var()` references
- **THEN** CSS variable declarations SHALL be generated (`--sizes-navHeight: 48px`)
- **THEN** original values SHALL be preserved in `_tokens.sizes`

#### Scenario: Nested scale values are flattened

- **WHEN** `addScale({ name: 'colors', values: { gray: { 100: '#f5f5f5', 900: '#1a1a1a' } } })` is called
- **THEN** the theme SHALL contain `colors` with flattened keys using `-` separator (`gray-100`, `gray-900`)

#### Scenario: emit defaults to false

- **WHEN** `addScale({ name: 'borders', values: { 1: '1px solid ' } })` is called without an `emit` property
- **THEN** no CSS variables SHALL be generated for the scale

### Requirement: addScale config object is type-safe

The config object SHALL be fully typed with generics that infer the scale name and value keys.

#### Scenario: Scale name is inferred as literal type

- **WHEN** `.addScale({ name: 'space', values: { 8: '0.5rem' } })` is chained
- **THEN** the returned builder's theme type SHALL include `space` as a key with `{ 8: string }` shape

#### Scenario: Subsequent addScale calls accumulate in theme type

- **WHEN** `.addScale({ name: 'space', values: {...} }).addScale({ name: 'sizes', values: {...} })` is chained
- **THEN** the returned builder's theme type SHALL include both `space` and `sizes`

## REMOVED Requirements

### Requirement: addScale factory signature

The two-argument form `addScale(name: string, factory: (theme: T) => Record)` is removed.

**Reason**: Factory callbacks are ceremony — 13 of 13 showcase scales use static values. Cross-scale references are handled by token ref syntax instead of JS interpolation, which is strictly better (preserves `var()` indirection).

**Migration**: Unwrap `addScale('name', () => ({...}))` to `addScale({ name: 'name', values: {...} })`. Replace factory interpolation (`\${colors.text}`) with token refs (`{colors.text}`).

### Requirement: createScaleVariables method

The `ThemeBuilder.createScaleVariables(key)` method is removed.

**Reason**: Absorbed into `addScale({ emit: true })`. Separate method was easy to forget and inconsistent with how colors auto-emit.

**Migration**: Remove `.createScaleVariables('name')` calls. Add `emit: true` to the corresponding `addScale` config.
