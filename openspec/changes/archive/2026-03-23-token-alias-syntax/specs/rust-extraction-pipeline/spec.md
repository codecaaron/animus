## MODIFIED Requirements

### Requirement: Theme scale resolution
The theme resolver SHALL accept a flattened theme JSON map (`{ "scale_name.key": "css_value" }`) AND a variable-name map (`{ "token_path": "css_variable_name" }`) and resolve style values against them. For each style property, the resolver SHALL look up the prop config to determine the CSS property name, scale name, and transform identifier. When a prop config has a `transform` field, the resolver SHALL emit the resolved value (after scale lookup) WITHOUT applying the transform, and SHALL include the transform name in the output metadata. Transform application is deferred to the Vite plugin's JS post-processing step. When a resolved string value (after scale lookup) contains `{...}` token alias patterns, the resolver SHALL resolve each alias using the variable-name map and flat value map before emitting the CSS declaration.

#### Scenario: Resolve scale lookup
- **WHEN** prop is `p` with value `8`, config says `{ property: "padding", scale: "space" }`, and theme has `{ "space.8": "0.5rem" }`
- **THEN** the resolver SHALL produce `{ "padding": "0.5rem" }`

#### Scenario: Resolve color mode variable
- **WHEN** prop is `color` with value `"background"`, config says `{ property: "color", scale: "colors" }`, and theme has `{ "colors.background": "var(--colors-background)" }`
- **THEN** the resolver SHALL produce `{ "color": "var(--colors-background)" }`

#### Scenario: Emit raw value with transform metadata
- **WHEN** prop is `width` with value `1`, config says `{ property: "width", transform: "size" }`
- **THEN** the resolver SHALL emit `{ "width": 1 }` as the raw value AND include metadata `{ property: "width", transform: "size", raw_value: 1 }` for post-processing

#### Scenario: Scale lookup before transform deferral
- **WHEN** prop is `borderRadius` with value `4`, config says `{ property: "borderRadius", scale: "radii", transform: "size" }`, and theme has `{ "radii.4": "4" }`
- **THEN** the resolver SHALL look up the scale first (getting `"4"`), then emit that as the raw value with transform metadata `{ property: "borderRadius", transform: "size", raw_value: "4" }` — scale resolution happens in Rust, transform application happens in JS

#### Scenario: No scale defined, transform deferred
- **WHEN** prop is `top` with value `100`, config says `{ property: "top", transform: "size" }` (no scale)
- **THEN** the resolver SHALL emit `{ "top": 100 }` as the raw value with transform metadata — no scale lookup, transform deferred

#### Scenario: No transform, value passes through
- **WHEN** prop is `display` with value `"flex"`, config says `{ property: "display" }` (no scale, no transform)
- **THEN** the resolver SHALL produce `{ "display": "flex" }` with no transform metadata

#### Scenario: Multi-property expansion with transform deferred
- **WHEN** prop is `inset` with value `0`, config says `{ properties: ["top","right","bottom","left"], transform: "size" }`
- **THEN** the resolver SHALL emit raw values for all four properties with transform metadata for each

#### Scenario: String value with token alias resolved during theme resolution
- **WHEN** prop is `border` with value `"1px solid {colors.primary}"`, config has no scale for `border`, variable map has `"colors.primary" → "--colors-primary"`
- **THEN** the resolver SHALL scan the string for `{...}` patterns, resolve `{colors.primary}` to `var(--colors-primary)`, and produce `{ "border": "1px solid var(--colors-primary)" }`

#### Scenario: Token alias with alpha in compound value
- **WHEN** prop is `boxShadow` with value `"0 4px 12px {colors.primary/20}"`, variable map has `"colors.primary" → "--colors-primary"`
- **THEN** the resolver SHALL resolve `{colors.primary/20}` to `color-mix(in srgb, var(--colors-primary) 20%, transparent)` and produce the complete compound CSS value
