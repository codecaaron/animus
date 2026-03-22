## MODIFIED Requirements

### Requirement: NAPI function signature change
The plugin SHALL pass a fifth argument `group_registry_json` to the Rust `extract()` function. This JSON maps group names to arrays of prop names, enabling the Rust pipeline to resolve which props belong to which groups.

#### Scenario: Serialize group registry
- **WHEN** the config has groups `space: ["p", "px", "py", "pt", "m", "mx", ...]` and `layout: ["display", "width", "height", ...]`
- **THEN** the plugin SHALL serialize the group registry to JSON: `{ "space": ["p", "px", "py", "pt", "m", "mx", ...], "layout": ["display", "width", "height", ...] }`

#### Scenario: Pass to extract function
- **WHEN** the transform hook calls the Rust `extract()` function
- **THEN** it SHALL pass `(source, filename, theme_json, config_json, group_registry_json)` — five arguments

### Requirement: Group registry serialization at build start
The plugin SHALL serialize the group registry from `@animus-ui/core/config` at `buildStart` alongside the existing theme and prop config serialization. The group registry SHALL map each group name to an array of its constituent prop names.

#### Scenario: Group registry from config
- **WHEN** config defines groups via `createAnimus().addGroup('space', spaceProps).addGroup('layout', layoutProps).build()`
- **THEN** the group registry SHALL be `{ "space": ["p", "px", "py", "pt", "pr", "pb", "pl", "m", "mx", "my", "mt", "mr", "mb", "ml"], "layout": ["display", "width", "height", "minWidth", "minHeight", "maxWidth", "maxHeight", "overflow", "overflowX", "overflowY", "verticalAlign"] }` (exact prop names from the group definitions)

### Requirement: Prop config serialization
The plugin SHALL serialize the prop configuration from `@animus-ui/core/config` into a JSON map at build start. Each prop entry SHALL include `property`, `properties` (if multi-property), `scale` (if theme-linked), and `transform` (as a string identifier: `"size"`, `"borderShorthand"`, `"gridItemRatio"`, or `null`).

#### Scenario: Serialize prop with scale and transform
- **WHEN** config has `borderRadius: { property: 'borderRadius', scale: 'radii', transform: size }`
- **THEN** the serialized entry SHALL be `{ "property": "borderRadius", "scale": "radii", "transform": "size" }`

#### Scenario: Serialize multi-property prop
- **WHEN** config has `px: { property: 'padding', properties: ['paddingLeft', 'paddingRight'], scale: 'space' }`
- **THEN** the serialized entry SHALL include both `property` and `properties` array
