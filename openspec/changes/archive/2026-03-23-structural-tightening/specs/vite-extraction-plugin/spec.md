## ADDED Requirements

### Requirement: Transform post-processing
The Vite plugin SHALL apply transform functions to the Rust pipeline's intermediate output as a JS post-processing step. After `analyze_project()` returns a manifest containing raw values and transform metadata, the plugin SHALL resolve each transform name to the actual JS function from the loaded config and apply it to produce final CSS values.

#### Scenario: Post-process size transform
- **WHEN** the manifest contains a declaration `{ property: "width", transform: "size", raw_value: 1 }`
- **THEN** the plugin SHALL look up the `size` function from the config, call `size(1)`, and replace the raw value with `"100%"` in the final CSS

#### Scenario: Post-process borderShorthand transform
- **WHEN** the manifest contains a declaration `{ property: "border", transform: "borderShorthand", raw_value: 2 }`
- **THEN** the plugin SHALL call `borderShorthand(2)` and replace the raw value with `"2px solid currentColor"` in the final CSS

#### Scenario: Post-process custom transform
- **WHEN** the manifest contains `{ property: "font-size", transform: "fluid", raw_value: 16 }` and the loaded config includes a transform named `"fluid"`
- **THEN** the plugin SHALL call the `fluid` function with `16` and substitute the result into the final CSS

#### Scenario: Unknown transform name produces warning
- **WHEN** the manifest contains a transform name that does not match any function in the loaded config
- **THEN** the plugin SHALL emit a warning in the extraction report and use the raw value as-is

### Requirement: Transform registry built from config
The Vite plugin SHALL build a transform registry (`Map<string, TransformFn>`) from the loaded config module at `buildStart`. The registry maps transform names (from `.transformName` properties) to the actual JS functions.

#### Scenario: Registry from default config
- **WHEN** the plugin loads `@animus-ui/core` config at build start
- **THEN** the transform registry SHALL contain entries for `'size'`, `'borderShorthand'`, `'gridItemRatio'`, and `'gridItem'`

#### Scenario: Registry from custom config
- **WHEN** the plugin loads a custom config that includes `createTransform('fluid', fn)`
- **THEN** the transform registry SHALL contain `'fluid'` in addition to any built-in transforms

## MODIFIED Requirements

### Requirement: Prop config serialization
The plugin SHALL serialize the prop configuration from `@animus-ui/core` into a JSON map at build start. Each prop entry SHALL include `property`, `properties` (if multi-property), `scale` (if theme-linked), and `transform` (as a string identifier derived from `.transformName ?? .name`, or omitted if not available).

#### Scenario: Serialize prop with scale and transform
- **WHEN** config has `borderRadius: { property: 'borderRadius', scale: 'radii', transform: size }` where `size.transformName === 'size'`
- **THEN** the serialized entry SHALL be `{ "property": "borderRadius", "scale": "radii", "transform": "size" }`

#### Scenario: Serialize multi-property prop
- **WHEN** config has `px: { property: 'padding', properties: ['paddingLeft', 'paddingRight'], scale: 'space' }`
- **THEN** the serialized entry SHALL include both `property` and `properties` array

#### Scenario: Serialize prop with unnamed transform
- **WHEN** config has `width: { property: 'width', transform: (v) => v }` (anonymous function, no `.transformName`, `.name === ''`)
- **THEN** the serialized entry SHALL NOT include a `transform` field — the transform is only available at runtime
