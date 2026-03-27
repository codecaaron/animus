### Requirement: Dynamic prop metadata in manifest

The manifest SHALL contain dynamic prop metadata at two levels:

1. **`UniverseManifest.dynamic_props`** — shared system prop dynamic metadata. Maps system prop names to `DynamicPropMeta` structs. A system prop appears here IFF the JSX scanner detected at least one dynamic usage across all files. Unchanged from current behavior.

2. **Per-component custom dynamic props** — stored alongside each component's replacement data in the analyzer. Built by intersecting the component's `custom_prop_configs` with dynamic custom prop usage detected for that component's binding. NOT stored in the shared `dynamic_props` map.

Each `DynamicPropMeta` (system or custom) SHALL include:
- `var_name`: CSS variable name (e.g., `--animus-p` for system, `--animus-size` for custom)
- `slot_class`: CSS class that activates the variable slot (system: `animus-dyn-p`, custom: `animus-dyn-{hash}-size`)
- `property`: primary CSS property name
- `properties`: multi-property list (if applicable)
- `transform_name`: optional transform identifier
- `scale_values`: optional pre-resolved scale value map

#### Scenario: System prop dynamic metadata in shared map
- **WHEN** `p` is used dynamically across files via `<Box p={someVar} />`
- **THEN** `manifest.dynamic_props["p"]` contains the dynamic metadata

#### Scenario: Custom prop dynamic metadata per-component
- **WHEN** Card defines `.props({ size: { property: 'flexBasis' } })` and `<Card size={someVar} />` is detected
- **THEN** Card's per-component data includes dynamic metadata for `size`, but `manifest.dynamic_props` does NOT contain `size`

#### Scenario: Same custom prop name on different components
- **WHEN** Card and Button both define `.props({ size: ... })` with different CSS properties, and both have dynamic usage
- **THEN** each component has independent dynamic metadata for `size` with different `property` values and different `slot_class` names

#### Scenario: Custom prop with inline scale
- **WHEN** a custom prop defines `scale: { xs: '10rem', sm: '15rem' }` (inline object)
- **THEN** `scale_values` is populated directly from the inline scale (no theme lookup needed)

#### Scenario: Custom prop with theme scale reference
- **WHEN** a custom prop defines `scale: 'space'` (string reference)
- **THEN** `scale_values` is populated by iterating theme entries matching the `space.` prefix (same as system props)

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

System prop CSS variables SHALL use the pattern `--animus-{prop-name-kebab}` (e.g., `--animus-p`, `--animus-border-radius`).

Custom prop CSS variables SHALL use the pattern `--animus-{prop-name-kebab}` (e.g., `--animus-size`, `--animus-logo-size`). Custom props do NOT require component-scoped variable names because CSS variables are applied via inline `style` on the element — each component instance is a separate DOM node.

Responsive breakpoint variants append the breakpoint name: `--animus-{prop}-{bp}` (e.g., `--animus-size-sm`).

Custom prop SLOT CLASSES SHALL use the pattern `animus-dyn-{classHash8}-{prop-name-kebab}` where `classHash8` is the first 8 characters of the component's class name hash. This scoping prevents collision between different components defining the same custom prop name with different CSS property targets.

#### Scenario: System prop variable name
- **WHEN** system prop `borderRadius` has dynamic usage
- **THEN** variable name is `--animus-border-radius`

#### Scenario: Custom prop variable name
- **WHEN** custom prop `logoSize` has dynamic usage
- **THEN** variable name is `--animus-logo-size`

#### Scenario: Custom prop slot class scoped
- **WHEN** Card (class `animus-Card-abc12345`) defines custom prop `size` with dynamic usage
- **THEN** base slot class is `animus-dyn-abc12345-size`, per-bp slot classes are `animus-dyn-abc12345-size-xs`, `animus-dyn-abc12345-size-sm`, etc.

#### Scenario: Two components same custom prop name
- **WHEN** Card (`animus-Card-abc12345`) and Button (`animus-Button-def67890`) both define `size`
- **THEN** slot classes are `animus-dyn-abc12345-size` and `animus-dyn-def67890-size` (no collision)

### Requirement: Lazy generation

Dynamic prop metadata (system or custom) SHALL only be generated for props with detected dynamic usage. Static-only props incur zero overhead — no slot class, no CSS variable, no dynamic config entry.

For custom props: if a component defines `.props({ size: ..., color: ... })` but only `size` has dynamic usage, only `size` gets dynamic metadata. `color` is handled purely via static utility classes.

#### Scenario: Custom prop static-only
- **WHEN** Card defines `.props({ size: ... })` and all JSX usages are static (`size="sm"`)
- **THEN** no dynamic metadata is generated for `size`, no slot class emitted

#### Scenario: Custom prop mixed static and dynamic
- **WHEN** Card defines `.props({ size: ... })` with both `size="sm"` and `size={someVar}` in JSX
- **THEN** static utility class AND dynamic slot class are both generated for `size`
