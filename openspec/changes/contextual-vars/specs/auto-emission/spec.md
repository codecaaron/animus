## ADDED Requirements

### Requirement: Prop currentVar configuration
The `Prop` interface SHALL support an optional `currentVar` field of type `string`. When present, it declares that setting this prop SHALL trigger emission of a sibling CSS custom property declaration with the same resolved value.

#### Scenario: Prop config with currentVar
- **WHEN** the color group defines `bg: { property: 'backgroundColor', scale: 'colors', currentVar: '--current-bg' }`
- **THEN** the prop config SHALL be valid and the `currentVar` value SHALL be serialized to the Rust extractor

#### Scenario: Prop config without currentVar
- **WHEN** a prop config does not include `currentVar`
- **THEN** behavior SHALL be unchanged — no sibling declaration is emitted

### Requirement: Sibling CSS declaration emission
When the Rust extractor processes a prop that has `currentVar` in its config, it SHALL emit an additional `CssDeclaration` with the CSS custom property name as the property and the same resolved value.

#### Scenario: Auto-emission in base styles
- **WHEN** a component has `.styles({ bg: 'surface' })` and `bg` has `currentVar: '--current-bg'`
- **THEN** the extracted CSS SHALL contain both `background-color: var(--color-surface);` and `--current-bg: var(--color-surface);`

#### Scenario: Auto-emission in variants
- **WHEN** a variant option sets `bg: 'coal'` and `bg` has `currentVar: '--current-bg'`
- **THEN** the variant's CSS block SHALL contain both `background-color: var(--color-coal);` and `--current-bg: var(--color-coal);`

#### Scenario: Auto-emission in states
- **WHEN** a state sets `bg: 'primary'` and `bg` has `currentVar: '--current-bg'`
- **THEN** the state's CSS block SHALL contain both declarations

#### Scenario: Auto-emission with system props
- **WHEN** a system prop class is generated for `bg="surface"` and `bg` has `currentVar: '--current-bg'`
- **THEN** the utility class CSS SHALL contain both declarations

#### Scenario: Cascade correctness with multiple layers
- **WHEN** a component sets `bg: 'surface'` in `.styles()` (base layer) and `bg: 'coal'` in a variant (variants layer)
- **THEN** base CSS SHALL contain `--current-bg: var(--color-surface)` and variant CSS SHALL contain `--current-bg: var(--color-coal)`
- **AND** the CSS cascade SHALL ensure the variant's `--current-bg` wins when the variant is active

#### Scenario: Auto-emission with raw CSS values
- **WHEN** a component has `bg: '#ff0000'` (raw CSS, not a token) and `bg` has `currentVar: '--current-bg'`
- **THEN** the extracted CSS SHALL contain `background-color: #ff0000;` and `--current-bg: #ff0000;`

### Requirement: Serialization of currentVar metadata
The system serialization SHALL include `currentVar` in the prop config metadata sent to the Rust extractor.

#### Scenario: PropConfig serialization
- **WHEN** a prop has `currentVar: '--current-bg'`
- **THEN** the serialized prop config SHALL include `currentVar: '--current-bg'` alongside `property`, `scale`, and other existing fields

### Requirement: Self-referential emission guard
The Rust extractor SHALL skip auto-emission when the resolved value would create a cyclic CSS custom property reference.

#### Scenario: Self-referential bg value
- **WHEN** a component has `bg: 'current-bg'` and `bg` has `currentVar: '--current-bg'`
- **AND** `current-bg` resolves to `var(--current-bg)`
- **THEN** the extracted CSS SHALL contain `background-color: var(--current-bg)` but SHALL NOT contain `--current-bg: var(--current-bg)`

#### Scenario: Non-self-referential value emits normally
- **WHEN** a component has `bg: 'surface'` and `bg` has `currentVar: '--current-bg'`
- **AND** `surface` resolves to `var(--color-surface)`
- **THEN** the extracted CSS SHALL contain both `background-color: var(--color-surface)` and `--current-bg: var(--color-surface)`

### Requirement: Responsive auto-emission
When a prop with `currentVar` has responsive values, the sibling declaration SHALL be emitted within each breakpoint's media query block.

#### Scenario: Responsive bg with auto-emission
- **WHEN** a component has `bg={{ _: 'surface', md: 'coal' }}` and `bg` has `currentVar: '--current-bg'`
- **THEN** the default CSS block SHALL contain `--current-bg: var(--color-surface)`
- **AND** the `md` media query block SHALL contain `--current-bg: var(--color-coal)`

### Requirement: Rust PropConfig struct
The Rust `PropConfig` struct SHALL include an optional `current_var` field parsed from the serialized prop config JSON.

#### Scenario: PropConfig deserialization
- **WHEN** the serialized prop config JSON contains `"currentVar": "--current-bg"`
- **THEN** the Rust `PropConfig` struct SHALL have `current_var: Some("--current-bg".to_string())`

#### Scenario: Missing currentVar defaults to None
- **WHEN** the serialized prop config JSON does not contain `"currentVar"`
- **THEN** the Rust `PropConfig` struct SHALL have `current_var: None`
