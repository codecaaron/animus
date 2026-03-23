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
`ParserProps<Config, T>` SHALL thread T through to `Scale<Config, T>` → `ScaleValue<Config, T>` for each prop in the config.

#### Scenario: Parser props resolve scales from T
- **WHEN** a parser is created for a config with `{ bg: { property: 'backgroundColor', scale: 'colors' } }`
- **THEN** the parser's props type SHALL include `bg?: ResponsiveProp<keyof T['colors'] | CSSPropertyValue>`
