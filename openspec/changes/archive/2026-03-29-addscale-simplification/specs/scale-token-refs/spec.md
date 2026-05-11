## ADDED Requirements

### Requirement: Token refs in scale values resolve at build time

Scale values MAY contain token ref syntax `{scale.key}`. These refs SHALL be resolved during `build()` by looking up the referenced value in the accumulated theme state.

#### Scenario: Token ref to emitted color

- **WHEN** a scale value contains `'0 0 12px {colors.text}'`
- **AND** `colors.text` has been emitted as `var(--color-text)`
- **THEN** the resolved value SHALL be `'0 0 12px var(--color-text)'`

#### Scenario: Token ref to emitted scale

- **WHEN** a scale value contains `'calc({sizes.navHeight} + 16px)'`
- **AND** `sizes.navHeight` has been emitted as `var(--sizes-navHeight)`
- **THEN** the resolved value SHALL be `'calc(var(--sizes-navHeight) + 16px)'`

#### Scenario: Multiple token refs in one value

- **WHEN** a scale value contains `'{sizes.sidebarWidth} 1fr {sizes.tocWidth}'`
- **THEN** all token refs SHALL be resolved independently

#### Scenario: Token ref to non-emitted scale is a type error

- **WHEN** a scale value contains `'{borders.1}'`
- **AND** `borders` was declared with `emit: false` (or default)
- **THEN** the template literal type SHALL reject this at compile time
- **AND** if somehow bypassed, `build()` SHALL emit a warning

### Requirement: Token refs constrained to emitted scales via types

The `values` property in the addScale config SHALL accept a template literal type that constrains token ref scale names to only scales that have been emitted (via `addColors`, `addColorModes`, or `addScale({ emit: true })`).

#### Scenario: Ref to emitted scale compiles

- **WHEN** `addScale({ name: 'shadows', values: { glow: '0 0 12px {colors.text}' } })` is written
- **AND** `colors` was previously added via `addColors()` (which auto-emits)
- **THEN** the type checker SHALL accept the value

#### Scenario: Ref to non-emitted scale fails to compile

- **WHEN** `addScale({ name: 'shadows', values: { glow: '{borders.1} {colors.text}' } })` is written
- **AND** `borders` was declared with `emit: false`
- **THEN** the type checker SHALL reject the value with a type error

#### Scenario: Ref to undeclared scale fails to compile

- **WHEN** `addScale({ name: 'shadows', values: { glow: '{bogus.key}' } })` is written
- **AND** no scale named `bogus` exists in the builder chain
- **THEN** the type checker SHALL reject the value with a type error

### Requirement: Token ref resolution order is independent of declaration order

Token refs SHALL be resolved at `build()` time, after all scales have been collected. The order of `addScale` calls in the chain SHALL NOT affect resolution — only whether the referenced scale exists and is emitted.

#### Scenario: Forward reference to later-declared emitted scale

- **WHEN** `addScale({ name: 'shadows', values: { soft: '{sizes.navHeight}' } })` is chained BEFORE `addScale({ name: 'sizes', emit: true, values: { navHeight: '48px' } })`
- **THEN** the token ref SHALL resolve correctly at `build()` time
- **NOTE** Type checking may still require declaration-order constraints — this is acceptable

#### Scenario: Self-referential token ref is rejected

- **WHEN** a scale value contains a token ref to its own scale (e.g., `addScale({ name: 'x', emit: true, values: { a: '{x.b}', b: '1px' } })`)
- **THEN** `build()` SHALL detect the circular reference and emit a warning
