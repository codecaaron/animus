## MODIFIED Requirements

### Requirement: Theme scale resolution
The theme resolver SHALL accept a flattened theme JSON map (`{ "scale_name.key": "css_value" }`) and resolve style values against it. For each style property, the resolver SHALL look up the prop config to determine the CSS property name, scale name, and transform identifier. When a prop config has a `transform` field, the resolver SHALL emit the resolved value (after scale lookup) WITHOUT applying the transform, and SHALL include the transform name in the output metadata. Transform application is deferred to the Vite plugin's JS post-processing step.

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

## REMOVED Requirements

### Requirement: Apply size transform
**Reason:** Transform execution moves to JS post-processing in the Vite plugin. Rust no longer applies any transforms.
**Migration:** The Vite plugin's post-processing step applies the `size` transform function from the loaded config module.

### Requirement: Apply borderShorthand transform
**Reason:** Transform execution moves to JS post-processing in the Vite plugin.
**Migration:** The Vite plugin's post-processing step applies the `borderShorthand` transform function from the loaded config module.

### Requirement: Apply gridItemRatio transform
**Reason:** Transform execution moves to JS post-processing in the Vite plugin.
**Migration:** The Vite plugin's post-processing step applies the `gridItemRatio` transform function from the loaded config module.

### Requirement: Transform dispatch by string identifier
**Reason:** The `apply_transform(name, value)` dispatch function is no longer needed — Rust does not execute transforms.
**Migration:** Transform names are passed through as metadata. The Vite plugin resolves names to functions and executes them.
