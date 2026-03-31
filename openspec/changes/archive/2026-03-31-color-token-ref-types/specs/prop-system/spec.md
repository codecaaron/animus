## MODIFIED Requirements

### Requirement: Prop definitions support scale resolution
Prop definitions with a `scale` property SHALL resolve values from the system's token type `T` instead of the global `Theme` interface. `ScaleValue<Config, T>` SHALL check `Config['scale'] extends keyof T` first, then fall through to inline MapScale/ArrayScale, then to raw CSS property values. The CompatTheme fallback chain SHALL NOT exist in the system package. When `Config['scale']` is `'colors'`, the resolved type SHALL additionally include `ColorTokenRef` to accept `{colors.X}` token reference syntax.

#### Scenario: String value resolved from theme scale
- **WHEN** a prop has `scale: 'colors'` and T defines `colors: { primary: string; secondary: string }`
- **THEN** `ScaleValue<Config, T>` SHALL resolve to `'primary' | 'secondary' | PropertyValues<Config> | ColorTokenRef`

#### Scenario: Value not in scale passes through
- **WHEN** a consumer passes `color="rebeccapurple"` (a raw CSS value not in the theme)
- **THEN** the value SHALL be accepted as a valid CSS property value (no type error)

#### Scenario: Scale not in T falls through to CSS values
- **WHEN** a prop has `scale: 'sizes'` but T does not define a `sizes` key
- **THEN** `ScaleValue<Config, T>` SHALL fall through to raw CSS property values (no CompatTheme fallback)

#### Scenario: Non-color scale does not include ColorTokenRef
- **WHEN** a prop has `scale: 'space'` and T defines `space: { 4: string; 8: string }`
- **THEN** `ScaleValue<Config, T>` SHALL resolve to `4 | 8 | PropertyValues<Config>` without `ColorTokenRef`

#### Scenario: Color token ref accepted on color-scale prop
- **WHEN** a prop has `scale: 'colors'` and value is `"{colors.ember/40}"`
- **THEN** `ScaleValue<Config, T>` SHALL accept the value via the `ColorTokenRef` union member
