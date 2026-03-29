## MODIFIED Requirements

### Requirement: Prop definitions support scale resolution
Prop definitions with a `scale` property SHALL resolve values from the system's token type `T` instead of the global `Theme` interface. `ScaleValue<Config, T>` SHALL check `Config['scale'] extends keyof T` first, then fall through to inline MapScale/ArrayScale, then to raw CSS property values. The CompatTheme fallback chain SHALL NOT exist in the system package.

#### Scenario: String value resolved from theme scale
- **WHEN** a prop has `scale: 'colors'` and T defines `colors: { primary: string; secondary: string }`
- **THEN** `ScaleValue<Config, T>` SHALL resolve to `'primary' | 'secondary' | PropertyValues<Config>`

#### Scenario: Value not in scale passes through
- **WHEN** a consumer passes `color="rebeccapurple"` (a raw CSS value not in the theme)
- **THEN** the value SHALL be accepted as a valid CSS property value (no type error)

#### Scenario: Scale not in T falls through to CSS values
- **WHEN** a prop has `scale: 'sizes'` but T does not define a `sizes` key
- **THEN** `ScaleValue<Config, T>` SHALL fall through to raw CSS property values (no CompatTheme fallback)

### Requirement: Prop definitions support transform functions
Transform functions on prop definitions SHALL remain unchanged. The system package SHALL use the same `TransformFn` and `NamedTransform` types. Transforms SHALL NOT be executed by the builder chain — they are an extraction pipeline concern.

#### Scenario: NamedTransform is serializable
- **WHEN** a prop has `transform: createTransform('size', fn)`
- **THEN** `ds.serialize()` SHALL extract the transform by name for the plugin's post-processing step

#### Scenario: Bare function still works
- **WHEN** a prop has `transform: (val) => ...` without `createTransform`
- **THEN** the builder chain SHALL accept it, but `.serialize()` SHALL skip it (unnamed transforms cannot be dispatched by the extraction pipeline)

## REMOVED Requirements

### Requirement: CompatTheme fallback in ScaleValue
**Reason:** CompatTheme was a leaky abstraction from the Emotion era. With T as a first-class generic, scale resolution goes directly through `T[scale]`. If T doesn't have a scale, the type falls through to CSS property values — no hidden defaults.
**Migration:** Consumers must define all scales in their token definition (`.withTokens()`). Scales previously provided by CompatTheme (space, fontSizes, lineHeights, etc.) must be explicitly included in the theme.

## ADDED Requirements

### Requirement: ThemeProps parameterized by T
`ThemeProps<Props, T>` SHALL replace `ThemeProps<Props>`. The `theme` property SHALL be typed as `T` instead of `AbstractTheme`.

#### Scenario: Theme prop carries T
- **WHEN** a component's props include theme access
- **THEN** `props.theme` SHALL be typed as `T`, not `AbstractTheme` (no `[key: string]: any` escape hatch)

### Requirement: ParserProps parameterized by T
`ParserProps<Config, T>` SHALL thread T through to `Scale<Config, T>` → `ScaleValue<Config, T>` for each prop in the config. Responsive prop types SHALL use `ResponsiveProp<V>` where `ResponsiveProp` is `V | MediaQueryMap<V>`. `MediaQueryMap<V>` SHALL be `{ _?: V } & { [K in keyof T['breakpoints']]?: V }` — a mapped type derived from the theme's breakpoint keys, not a hardcoded interface.

#### Scenario: Parser props resolve scales from T
- **WHEN** a parser is created for a config with `{ bg: { property: 'backgroundColor', scale: 'colors' } }`
- **THEN** the parser's props type SHALL include `bg?: ResponsiveProp<keyof T['colors'] | CSSPropertyValue>`

#### Scenario: Responsive prop accepts only theme breakpoint keys
- **WHEN** T defines `breakpoints: { sm: number; lg: number }` and a parser prop accepts `ResponsiveProp<string>`
- **THEN** `{ _: 'red', sm: 'blue', lg: 'green' }` SHALL type-check but `{ md: 'blue' }` SHALL be a type error

### REMOVED — Requirement: Responsive array syntax
**Reason:** Array syntax couples positional indices to a fixed breakpoint count. With user-defined breakpoint keys, positional ordering is ambiguous and fragile. Object syntax is key-based and naturally adapts to any breakpoint set.
**Migration:** Replace `p={[8, 12, , 16]}` with `p={{ _: 8, xs: 12, lg: 16 }}`. The `_` key replaces index 0 (default), named keys replace positional indices.

### Requirement: MediaQueryMap is a mapped type
`MediaQueryMap<T>` SHALL be defined as a mapped type over `Theme['breakpoints']` rather than a hardcoded interface. The shape SHALL be `{ _?: T } & { [K in keyof Theme['breakpoints']]?: T }`. When `Theme` is not augmented, it SHALL fall back to `{ _?: T } & { [key: string]: T | undefined }`.

#### Scenario: Mapped type reflects custom breakpoints
- **WHEN** Theme is augmented with `breakpoints: { mobile: number; tablet: number; desktop: number }`
- **THEN** `MediaQueryMap<string>` SHALL resolve to `{ _?: string; mobile?: string; tablet?: string; desktop?: string }`

#### Scenario: Fallback when Theme is not augmented
- **WHEN** Theme is NOT augmented
- **THEN** `MediaQueryMap<T>` SHALL accept any string key (open record), not restrict to `xs | sm | md | lg | xl`

### Requirement: ResponsiveProp simplified to two forms
`ResponsiveProp<T>` SHALL be `T | MediaQueryMap<T>`. The `MediaQueryArray<T>` union arm SHALL be removed entirely. No array-based responsive syntax SHALL be supported at the type level.

#### Scenario: Object syntax accepted
- **WHEN** a prop value is `{ _: 8, md: 16 }`
- **THEN** it SHALL type-check as `ResponsiveProp<number>` with the appropriate breakpoint keys

#### Scenario: Array syntax rejected
- **WHEN** a prop value is `[8, 12, , 16]`
- **THEN** it SHALL NOT type-check as `ResponsiveProp<number>` — arrays are no longer valid responsive values

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
