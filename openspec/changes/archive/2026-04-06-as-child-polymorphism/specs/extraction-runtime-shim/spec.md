## MODIFIED Requirements

### Requirement: createComponent factory
`createComponent(element, className, config, systemPropMap?, dynamicPropConfig?)` SHALL be the sole export from `@animus-ui/system` for building extracted components. The `config` object SHALL accept optional `customPropMap` and `customDynamicConfig` fields for per-component custom prop resolution.

When `props.asChild` is `true`, `createComponent` SHALL resolve className and dynamic styles as usual, then delegate rendering to the single child element via `cloneElement` instead of rendering its own element via `createElement`. The `asChild` prop SHALL be included in the `filterProps` set and never forwarded to the DOM.

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

#### Scenario: asChild rendering delegates to child element
- **WHEN** a component receives `asChild={true}` with a single React element child
- **THEN** the runtime SHALL resolve className and dynamic styles as usual, then call `cloneElement` on the child with merged className, composed ref, and merged style — instead of calling `createElement` with its own element tag

#### Scenario: asChild prop filtered from DOM
- **WHEN** a component receives `asChild={true}`
- **THEN** `asChild` SHALL NOT appear as a DOM attribute on the rendered element
