## MODIFIED Requirements

### Requirement: createComponent factory

`createComponent(element, className, config, systemPropMap?, dynamicPropConfig?)` SHALL be the sole export from `@animus-ui/system` for building extracted components. The `config` object SHALL accept optional `customPropMap` and `customDynamicConfig` fields for per-component custom prop resolution.

- `customPropMap`: `Record<string, Record<string, string>>` — maps custom prop name → value key → CSS class name. Same structure as `systemPropMap` but scoped to one component.
- `customDynamicConfig`: `Record<string, { varName, slotClass, property, properties?, transformName?, transform?, scaleValues? }>` — per-component CSS variable fallback metadata for dynamic custom props.

When resolving a prop value at render time, the runtime SHALL check `customPropMap` first, then `systemPropMap`. If a match is found in `customPropMap`, the corresponding class is applied and no further lookup occurs. This ensures custom props override system props when names overlap.

For dynamic custom props (value not found in `customPropMap`), the runtime SHALL check `customDynamicConfig` for CSS variable slot metadata. Resolution follows the same order as system dynamic props: scale value lookup → transform → unit fallback. CSS variables are applied via the element's inline `style` attribute.

#### Scenario: Static custom prop resolved via customPropMap
- **WHEN** a component has `config.customPropMap = { size: { sm: 'animus-u-abc' } }` and receives `size="sm"`
- **THEN** `animus-u-abc` class is added to the element and `size` is not forwarded to the DOM

#### Scenario: Dynamic custom prop resolved via customDynamicConfig
- **WHEN** a component has `config.customDynamicConfig = { size: { varName: '--animus-size', slotClass: 'animus-dyn-x-size', property: 'flex-basis', scaleValues: { sm: '15rem' } } }` and receives `size={someVar}`
- **THEN** the slot class `animus-dyn-x-size` is added to the element and `--animus-size` is set as an inline style variable with the resolved value

#### Scenario: Custom prop with scale resolution
- **WHEN** a component has `customDynamicConfig.size.scaleValues = { xs: '10rem', sm: '15rem' }` and receives `size="sm"` dynamically
- **THEN** the CSS variable `--animus-size` is set to `15rem` (scale-resolved value)

#### Scenario: Custom prop with transform
- **WHEN** a component has `customDynamicConfig.spacing.transform` set to a transform function and receives `spacing={4}`
- **THEN** the transform is applied to the raw value before setting the CSS variable

#### Scenario: Custom prop takes precedence over system prop
- **WHEN** a component has both `systemPropMap` entry for `p` and `customPropMap` entry for `p`, and receives `p="lg"`
- **THEN** the `customPropMap` entry is used, not the `systemPropMap` entry

#### Scenario: Responsive custom prop with dynamic value
- **WHEN** a component has `customDynamicConfig` for `size` and receives `size={{ _: baseVal, sm: smVal }}`
- **THEN** the runtime applies base slot class (`animus-dyn-{hash}-size`) and per-bp slot class (`animus-dyn-{hash}-size-sm`), sets `--animus-size` to the resolved base value and `--animus-size-sm` to the resolved sm value

#### Scenario: Responsive dynamic prop only applies used breakpoint classes
- **WHEN** a component receives `p={{ _: 8, md: 16 }}` dynamically
- **THEN** the runtime applies `.animus-dyn-p` and `.animus-dyn-p-md` only — breakpoint classes for xs, sm, lg, xl are NOT applied

#### Scenario: No customPropMap or customDynamicConfig
- **WHEN** a component config has no `customPropMap` and no `customDynamicConfig`
- **THEN** behavior is identical to pre-change (system props only)

### Requirement: Prop filtering includes all prop types

All prop types — variant props, state props, system prop names, and custom prop names — SHALL be stripped from the `domProps` object before forwarding to the underlying DOM element. Custom prop names are included in the `systemPropNames` array alongside system prop names. The `as` prop SHALL also be excluded from DOM forwarding.

#### Scenario: Custom prop names filtered from DOM
- **WHEN** a component has `config.systemPropNames = ['p', 'mx', 'size', 'logoSize']` where `size` and `logoSize` are custom props
- **THEN** none of `p`, `mx`, `size`, or `logoSize` are forwarded to the DOM element

### Requirement: Dynamic style memoization

Dynamic CSS variable styles for both system props and custom props SHALL be memoized via `useRef`. The runtime SHALL maintain a single style object that includes CSS variables from both system and custom dynamic props. A new style object SHALL only be allocated when at least one dynamic value changes.

#### Scenario: Mixed system and custom dynamic props memoized together
- **WHEN** a component has both system dynamic props (e.g., `p`) and custom dynamic props (e.g., `size`) with dynamic values
- **THEN** a single memoized style object contains CSS variables for both (`--animus-p` and `--animus-size`)

#### Scenario: Custom dynamic prop value unchanged
- **WHEN** a component re-renders with the same custom prop dynamic value
- **THEN** the existing memoized style object is reused (no new allocation)

## ADDED Requirements

### Requirement: Custom prop map resolution order

When resolving prop values to CSS classes, the runtime SHALL check sources in this order:
1. `config.customPropMap[propName][valueKey]` (per-component custom props)
2. `systemPropMap[propName][valueKey]` (shared system props)
3. `config.customDynamicConfig[propName]` (per-component dynamic fallback)
4. `dynamicPropConfig[propName]` (shared system dynamic fallback)

The first match wins. This ensures per-component custom prop definitions always override shared system prop behavior.

#### Scenario: Full resolution cascade
- **WHEN** a prop name exists in both `customPropMap` and `systemPropMap` with matching value keys
- **THEN** the `customPropMap` class is used

#### Scenario: Custom prop falls through to dynamic
- **WHEN** a custom prop value is not found in `customPropMap` but `customDynamicConfig` exists for that prop
- **THEN** the dynamic CSS variable fallback path is used
