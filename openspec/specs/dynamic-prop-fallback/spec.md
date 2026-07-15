## Purpose

Requirements for the `dynamic-prop-fallback` capability: Dynamic prop metadata in manifest; CSS variable slot class generation; Dynamic prop variable naming convention; and 1 more.

## Requirements

### Requirement: Dynamic prop metadata in manifest

The manifest SHALL contain dynamic prop metadata at two levels:

1. **`UniverseManifest.dynamic_props`** — shared system prop dynamic metadata. Maps system
   prop names to `DynamicPropMeta` structs. A system prop appears here IFF it is **active
   and reachable** — a member of the union of `systemPropNames` across components retained
   by reconciliation (rendered bindings, provenance parents, `asClass`, and compose slots).
   Imported aliases are canonicalized, and uncertain identity widens to all evaluated
   components. Detected prop usage is NOT a precondition.

2. **Per-component custom dynamic props** — stored alongside each component's replacement
   data in the analyzer. Built by intersecting the component's `custom_prop_configs` with
   dynamic custom prop usage detected for that component's binding. NOT stored in the
   shared `dynamic_props` map.

Each `DynamicPropMeta` (system or custom) SHALL include:

- `var_name`: CSS variable name (e.g., `--animus-p` for system, `--animus-size` for custom)
- `slot_class`: CSS class that activates the variable slot (system: `animus-dyn-p`, custom: `animus-dyn-{hash}-size`)
- `property`: primary CSS property name
- `properties`: multi-property list (if applicable)
- `transform_name`: optional transform identifier
- `scale_values`: optional pre-resolved scale value map

#### Scenario: Active system prop metadata without dynamic usage

- **WHEN** `p` is active on at least one reconciliation-retained component and every JSX
  usage of `p` in the project is static (`p="8"`) or absent
- **THEN** `manifest.dynamic_props["p"]` contains the dynamic metadata

#### Scenario: Inactive system prop excluded

- **WHEN** no reconciliation-retained component includes `gridArea` in its
  `systemPropNames`
- **THEN** `manifest.dynamic_props` does NOT contain `gridArea`

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

For each prop in `dynamic_props` (and each per-component custom dynamic prop), the CSS
generator SHALL produce a variable slot class that reads from CSS custom properties with
breakpoint fallback chains.

#### Scenario: Base variable slot class for single-property prop

- **WHEN** prop `p` (property: `padding`) is active on any reconciliation-retained component
- **THEN** the CSS output SHALL include:
  ```css
  @layer system {
    .animus-dyn-p {
      padding: var(--animus-p);
    }
  }
  ```

#### Scenario: Breakpoint fallback chains

- **WHEN** prop `p` is active and the system defines breakpoints `sm: 640px` and `md: 768px`
- **THEN** the CSS output SHALL include responsive rules with fallback chains:
  ```css
  @media (min-width: 640px) {
    .animus-dyn-p {
      padding: var(--animus-p-sm, var(--animus-p));
    }
  }
  @media (min-width: 768px) {
    .animus-dyn-p {
      padding: var(--animus-p-md, var(--animus-p));
    }
  }
  ```

#### Scenario: Multi-property variable slot class

- **WHEN** prop `px` (properties: `padding-left`, `padding-right`) is active
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

#### Scenario: No active props generates no slot classes

- **WHEN** no evaluated components exist (empty project)
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

### Requirement: Total system prop floor

Dynamic prop metadata and variable slot classes SHALL be generated for every reachable
active system prop — the union of `systemPropNames` across reconciliation-retained
components — regardless of whether any usage of that prop was detected. Reachability
SHALL include rendered bindings, provenance parents, `asClass` terminals, and compose
slots. A single canonical component-identity policy SHALL own both floor selection and
the rendered-component set consumed by reconciliation. Imported JSX aliases SHALL
resolve to their canonical component binding. If any component-like rendered identity
cannot be mapped with certainty, both sets SHALL widen to all evaluated components.
Lowercase JSX intrinsics and string-literal native `createElement` calls SHALL NOT cause
that widening. A system prop value that does not match a static utility class SHALL
resolve through the CSS variable slot path.

#### Scenario: Unrendered component prop is excluded

- **WHEN** `Used` activates `p`, `Unused` activates `display`, and only `Used` survives
  reconciliation
- **THEN** `p` has shared dynamic metadata while `display` does not

#### Scenario: Imported alias retains canonical component props

- **WHEN** `Box` is imported as `Renamed` and JSX renders `<Renamed />`
- **THEN** every active system prop on `Box` remains in the shared dynamic floor

#### Scenario: Uncertain component identity widens

- **WHEN** a component-like render is unresolved, including `<UI.Box />`,
  `React.createElement(UI.Box)`, a local alias such as `<C />`, or a dynamic
  `createElement(getComponent())` target
- **THEN** the shared dynamic floor includes all active system props and reconciliation
  retains every evaluated component rather than omitting a potentially reachable one

#### Scenario: Native elements do not widen

- **WHEN** the project renders lowercase JSX such as `<div />` or calls
  `createElement('div')`
- **THEN** those known-native identities do not widen the floor or reconciliation set

#### Scenario: Canonical alias identity survives reconciliation

- **WHEN** `Box` is imported as `Renamed` and JSX renders `<Renamed />`
- **THEN** `Box` owns the floor, system/custom usage, residue, variants, and states, and
  reconciliation retains `Box` rather than pruning it under the file-local alias

#### Scenario: Spread-delivered value on a statically-used prop

- **WHEN** `p` is active, every visible usage of `p` is static, and at runtime a component
  receives `p={someValue}` through `{...props}` where `someValue` is a scale key
- **THEN** the element renders with the `animus-dyn-p` slot class and an inline
  `--animus-p` custom property carrying the resolved scale value

#### Scenario: Static resolution unchanged by the floor

- **WHEN** `p="8"` is used and `8` has a static utility class
- **THEN** the element receives the identical static utility class as before the floor
  existed, and no slot class or custom property for `p`

### Requirement: Custom prop lazy generation

Per-component custom dynamic metadata SHALL only be generated for custom props with
detected dynamic usage. Static-only custom props incur zero overhead — no slot class, no
CSS variable, no dynamic config entry.

#### Scenario: Custom prop static-only

- **WHEN** Card defines `.props({ size: ... })` and all JSX usages are static (`size="sm"`)
- **THEN** no dynamic metadata is generated for `size`, no slot class emitted

#### Scenario: Custom prop mixed static and dynamic

- **WHEN** Card defines `.props({ size: ... })` with both `size="sm"` and `size={someVar}` in JSX
- **THEN** static utility class AND dynamic slot class are both generated for `size`

### Requirement: Runtime drop diagnostic

In development builds, when a prop value matches neither a static utility class entry nor
any dynamic prop configuration, the runtime SHALL emit a console diagnostic identifying
the component's base class name, the prop name, and the serialized value. Production
builds SHALL contain no diagnostic code on this path.

#### Scenario: Dev-mode drop produces a diagnostic

- **WHEN** a development build resolves a custom prop value that has no static class and
  no dynamic configuration
- **THEN** a console warning is emitted containing the component base class name, the prop
  name, and the serialized value, and the value is otherwise handled as before

#### Scenario: Production build carries no diagnostic

- **WHEN** the showcase application is built in production mode
- **THEN** the emitted JS bundles contain no occurrence of the diagnostic message string

#### Scenario: Resolving values produce no diagnostic

- **WHEN** a development build resolves a prop value through the static map or the CSS
  variable slot path
- **THEN** no diagnostic is emitted
