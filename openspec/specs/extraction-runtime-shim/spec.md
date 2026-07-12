## Purpose

Requirements for the `extraction-runtime-shim` capability: createComponent factory; Ref forwarding; Prop filtering includes all prop types; and 7 more.

## Requirements

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

### Requirement: Ref forwarding

The component returned by `createComponent` SHALL forward refs to the underlying DOM element.

#### Scenario: Forward ref

- **WHEN** a ref is passed to the component via `ref={myRef}`
- **THEN** `myRef.current` SHALL reference the underlying DOM element (e.g., the `<button>` element)

### Requirement: Prop filtering includes all prop types

All prop types — variant props, state props, system prop names, and custom prop names — SHALL be stripped from the `domProps` object before forwarding to the underlying DOM element. Custom prop names are included in the `systemPropNames` array alongside system prop names. The `as` prop SHALL also be excluded from DOM forwarding.

#### Scenario: Custom prop names filtered from DOM

- **WHEN** a component has `config.systemPropNames = ['p', 'mx', 'size', 'logoSize']` where `size` and `logoSize` are custom props
- **THEN** none of `p`, `mx`, `size`, or `logoSize` are forwarded to the DOM element

### Requirement: Polymorphic `as` prop

The component returned by `createComponent` SHALL accept an `as` prop that overrides the rendered element at usage time. The `as` prop SHALL accept either an HTML tag name (`keyof JSX.IntrinsicElements`) or a React component that accepts `className` in its props (`ComponentType<{ className?: string }>`). Components that do not accept `className` SHALL be rejected at the type level. The `as` prop SHALL NOT be forwarded to the rendered element.

#### Scenario: Override element with HTML tag

- **WHEN** a component created with `createComponent('div', ...)` is rendered with `as="section"`
- **THEN** the rendered element SHALL be a `<section>` with the extracted class names applied

#### Scenario: Override element with React component

- **WHEN** a component created with `createComponent('a', ...)` is rendered with `as={NextLink}` where NextLink accepts `className`
- **THEN** the rendered element SHALL be `<NextLink className="..." />` with all extracted class names forwarded

#### Scenario: Component without className rejected at type level

- **WHEN** a component is used with `as={SomeComponent}` where `SomeComponent` does not accept `className` in its props
- **THEN** the TypeScript compiler SHALL report a type error

#### Scenario: as prop is filtered from DOM

- **WHEN** a component is rendered with `as="section"`
- **THEN** the `as` prop SHALL NOT be forwarded to the underlying element as an HTML attribute

#### Scenario: Types remain static

- **WHEN** a component created with `.asElement('div')` is rendered with `as="button"`
- **THEN** the component's ref type and element-specific props SHALL remain as `HTMLDivElement` — the `as` prop does NOT mutate the component's type signature

### Requirement: Extend method directs to source-code extension

The component returned by `createComponent` SHALL have an `.extend()` method that throws an error directing the developer to use the builder API in source code. Extracted components cannot be runtime-extended because their configuration contains resolved CSS values, not the original Prop/Parser objects that AnimusExtended requires. Extensions MUST be authored in source code where the extraction pipeline can trace them at build time.

#### Scenario: Extend an extracted component throws

- **WHEN** `Button.extend()` is called on an extracted component at runtime
- **THEN** it SHALL throw an Error with a message explaining that extensions must be authored in source code using the builder API, so the extraction pipeline can resolve them at build time

#### Scenario: Source-code extension is extractable

- **WHEN** a developer writes `import { Button } from './Button'; const Primary = Button.extend().styles({...}).asElement('button')` in source code
- **THEN** the extraction pipeline SHALL resolve the extension at build time via the manifest (Arc 3), producing correct merged CSS without any runtime extension

### Requirement: Bundle size

The runtime shim package (`@animus-ui/runtime`) SHALL be less than 1KB gzipped, excluding React as a peer dependency.

#### Scenario: Measure bundle size

- **WHEN** the runtime package is built and gzip-compressed
- **THEN** the compressed size SHALL be under 1024 bytes

### Requirement: Dynamic style memoization

Dynamic CSS variable styles for both system props and custom props SHALL be memoized via `useRef`. The runtime SHALL maintain a single style object that includes CSS variables from both system and custom dynamic props. A new style object SHALL only be allocated when at least one dynamic value changes.

#### Scenario: Mixed system and custom dynamic props memoized together

- **WHEN** a component has both system dynamic props (e.g., `p`) and custom dynamic props (e.g., `size`) with dynamic values
- **THEN** a single memoized style object contains CSS variables for both (`--animus-p` and `--animus-size`)

#### Scenario: Custom dynamic prop value unchanged

- **WHEN** a component re-renders with the same custom prop dynamic value
- **THEN** the existing memoized style object is reused (no new allocation)

### Requirement: System prop value serialization for lookup

The runtime shim SHALL serialize system prop values to string keys for lookup in the shared map. Numeric values SHALL be converted to their string representation. Responsive objects SHALL be serialized to a canonical string format that matches the extraction pipeline's key generation.

#### Scenario: Numeric value lookup key

- **WHEN** component receives `p={8}`
- **THEN** the runtime SHALL look up key `"8"` in `systemPropMap.p`

#### Scenario: String value lookup key

- **WHEN** component receives `color="primary"`
- **THEN** the runtime SHALL look up key `"primary"` in `systemPropMap.color`

#### Scenario: Responsive value lookup key

- **WHEN** component receives `mt={{ _: 8, sm: 16 }}`
- **THEN** the runtime SHALL serialize to a canonical key (e.g., `"_:8|sm:16"`) and look up in `systemPropMap.mt`

### Requirement: Smoke test type verification

The smoke test package SHALL include a `tsconfig.json` and a `typecheck` script that runs `tsc --noEmit` to verify source-level type correctness of all component definitions and JSX usage.

#### Scenario: Type checking catches invalid variant

- **WHEN** smoke test source contains `<Button variant="typo">`
- **THEN** `tsc --noEmit` SHALL report a type error because `"typo"` is not in the variant union

#### Scenario: Type checking passes for valid usage

- **WHEN** smoke test source contains valid builder chains and JSX props
- **THEN** `tsc --noEmit` SHALL complete with zero errors

#### Scenario: asComponent path is exercised

- **WHEN** the smoke test includes a component defined via `.asComponent(WrappedComponent)`
- **THEN** the component SHALL extract correctly, forward `className` to the wrapped component, and render in the smoke test app

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
