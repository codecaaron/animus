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
