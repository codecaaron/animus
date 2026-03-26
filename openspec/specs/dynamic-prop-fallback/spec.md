### Requirement: Dynamic prop metadata in manifest
The extraction pipeline SHALL include a `dynamic_props` field in `UniverseManifest` mapping prop names to their dynamic configuration. A prop appears in `dynamic_props` if and only if the JSX scanner detected at least one dynamic usage across all scanned files.

#### Scenario: Prop with dynamic usage appears in manifest
- **WHEN** `analyzeProject()` processes files where `<Box p={variable} />` appears
- **THEN** `manifest.dynamic_props` SHALL contain an entry for `"p"` with `var_name: "--animus-p"`, `slot_class: "animus-dyn-p"`, `property: "padding"`, and `transform_name: null` (if no transform configured)

#### Scenario: Prop with only static usage excluded from manifest
- **WHEN** all usages of `display` across all files are static literals (e.g., `display="flex"`, `display="block"`)
- **THEN** `manifest.dynamic_props` SHALL NOT contain an entry for `"display"`

#### Scenario: Prop with transform includes transform name
- **WHEN** `<Box borderRadius={radius} />` appears and `borderRadius` has a configured `size` transform
- **THEN** `manifest.dynamic_props["borderRadius"]` SHALL have `transform_name: "size"`, `var_name: "--animus-border-radius"`, `slot_class: "animus-dyn-border-radius"`

#### Scenario: Multi-property prop records all properties
- **WHEN** `<Box px={value} />` appears dynamically and `px` maps to `["padding-left", "padding-right"]`
- **THEN** `manifest.dynamic_props["px"]` SHALL have `properties: ["padding-left", "padding-right"]` and the variable slot class SHALL set both properties

#### Scenario: Scale values pre-resolved for runtime lookup
- **WHEN** `<StratumRow borderBottom={value} />` appears dynamically and `borderBottom` has scale `"borders"`
- **THEN** `manifest.dynamic_props["borderBottom"].scale_values` SHALL contain all entries from the `borders` theme scale pre-resolved (e.g., `{ "1": "1px solid", "2": "2px solid" }`)

### Requirement: CSS variable slot class generation
For each prop in `dynamic_props`, the CSS generator SHALL produce a variable slot class that reads from CSS custom properties with breakpoint fallback chains.

#### Scenario: Base variable slot class for single-property prop
- **WHEN** prop `p` (property: `padding`) has dynamic usage
- **THEN** the CSS output SHALL include:
  ```css
  @layer system {
    .animus-dyn-p { padding: var(--animus-p); }
  }
  ```

#### Scenario: Breakpoint fallback chains
- **WHEN** prop `p` has dynamic usage and the system defines breakpoints `sm: 640px` and `md: 768px`
- **THEN** the CSS output SHALL include responsive rules with fallback chains:
  ```css
  @media (min-width: 640px) {
    .animus-dyn-p { padding: var(--animus-p-sm, var(--animus-p)); }
  }
  @media (min-width: 768px) {
    .animus-dyn-p { padding: var(--animus-p-md, var(--animus-p)); }
  }
  ```

#### Scenario: Multi-property variable slot class
- **WHEN** prop `px` (properties: `padding-left`, `padding-right`) has dynamic usage
- **THEN** the CSS output SHALL include:
  ```css
  @layer system {
    .animus-dyn-px {
      padding-left: var(--animus-px);
      padding-right: var(--animus-px);
    }
  }
  ```

#### Scenario: Custom prop layer placement
- **WHEN** a custom prop `logoSize` has dynamic usage
- **THEN** the variable slot class SHALL be placed in `@layer custom`, not `@layer system`

#### Scenario: No dynamic usage generates no slot classes
- **WHEN** no props have dynamic usage across any scanned files
- **THEN** the CSS output SHALL contain zero variable slot classes and zero CSS custom property declarations

### Requirement: Dynamic prop variable naming convention
CSS custom property names SHALL follow the pattern `--animus-{prop-name-kebab}` for the base value and `--animus-{prop-name-kebab}-{breakpoint}` for responsive breakpoints. Prop names SHALL be converted from camelCase to kebab-case.

#### Scenario: Base variable name (short prop)
- **WHEN** prop name is `mt`
- **THEN** the base CSS variable SHALL be `--animus-mt`

#### Scenario: Base variable name (camelCase prop)
- **WHEN** prop name is `borderRadius`
- **THEN** the base CSS variable SHALL be `--animus-border-radius`

#### Scenario: Breakpoint variable name
- **WHEN** prop name is `mt` and breakpoint is `sm`
- **THEN** the breakpoint CSS variable SHALL be `--animus-mt-sm`

### Requirement: Lazy generation
Variable slot classes, dynamic prop metadata, and transform function shipping SHALL only be generated for props with detected dynamic usage. Props with only static values SHALL incur zero dynamic overhead.

#### Scenario: Mixed static and dynamic prop usage
- **WHEN** prop `p` has both static usages (`p={8}`, `p={16}`) and dynamic usages (`p={variable}`)
- **THEN** BOTH static utility classes AND the variable slot class SHALL be generated — static classes for literal values, variable slot class for dynamic fallback

#### Scenario: All-static project
- **WHEN** a project uses only literal prop values
- **THEN** the manifest SHALL have an empty `dynamic_props` map, no variable slot CSS SHALL be emitted, and no transform functions SHALL be shipped to the runtime
