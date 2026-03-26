### Requirement: createComponent factory
The runtime shim SHALL export `createComponent(element, className, config, systemPropMap?)` which returns a `React.forwardRef` component. The `element` parameter accepts EITHER an HTML tag string (e.g., `'button'`) OR a React component reference (for `.asComponent()` extensions). The `className` is the base extracted class name. The `config` describes variant props, state props, and system prop names. The optional `systemPropMap` parameter provides the shared prop→value→className lookup table. The function SHALL be exported from `@animus-ui/system` (not `@animus-ui/runtime`).

#### Scenario: Render with HTML tag
- **WHEN** `createComponent('button', 'animus-Btn-x7f2', {})` creates a component and it is rendered
- **THEN** the rendered element SHALL be `<button class="animus-Btn-x7f2" />`

#### Scenario: Render with component reference
- **WHEN** `createComponent(NextLink, 'animus-Link-abc', {})` creates a component with a React component as the element
- **THEN** the rendered element SHALL be `<NextLink className="animus-Link-abc" />` — the component reference is used as the element type in `React.createElement`

#### Scenario: Render with variant prop
- **WHEN** config has variants and component is rendered with `variant="stroke"`
- **THEN** the rendered element SHALL have the variant modifier class appended

#### Scenario: Render with system prop via shared map
- **WHEN** `systemPropMap` is `{ p: { "8": "animus-u-a1b2c3" } }`, config has `{ systemPropNames: ["p"] }`, and component is rendered with `p={8}`
- **THEN** the rendered element SHALL have class `"animus-Btn-x7f2 animus-u-a1b2c3"`

#### Scenario: Render with state prop
- **WHEN** config is `{ states: ['loading', 'disabled'] }` and component is rendered with `loading={true}`
- **THEN** the rendered element SHALL have class `"animus-Btn-x7f2 animus-Btn-x7f2--loading"`

#### Scenario: Render with multiple active states
- **WHEN** component is rendered with `loading={true} disabled={true}`
- **THEN** the rendered element SHALL have class `"animus-Btn-x7f2 animus-Btn-x7f2--loading animus-Btn-x7f2--disabled"`

#### Scenario: Default variant applied
- **WHEN** config has `{ variants: { variant: { options: ['fill', 'stroke'], default: 'fill' } } }` and component is rendered with no `variant` prop
- **THEN** the rendered element SHALL have class `"animus-Btn-x7f2 animus-Btn-x7f2--variant-fill"`

#### Scenario: System prop value not in shared map
- **WHEN** `systemPropMap` is `{ p: { "8": "animus-u-a1b2c3" } }`, config has `{ systemPropNames: ["p"] }`, and component is rendered with `p={24}`
- **THEN** the rendered element SHALL have class `"animus-Btn-x7f2"` only — the value `24` has no matching utility class and SHALL be silently ignored

#### Scenario: Responsive system prop via shared map
- **WHEN** `systemPropMap` is `{ mt: { "_:8|sm:16": "animus-u-d4e5f6" } }`, config has `{ systemPropNames: ["mt"] }`, and component is rendered with `mt={{ _: 8, sm: 16 }}`
- **THEN** the rendered element SHALL have class `"animus-Btn-x7f2 animus-u-d4e5f6"`

#### Scenario: System prop overrides base style via layer
- **WHEN** component has base style `padding: 0` in `@layer base` and is rendered with `p={8}` producing utility class in `@layer system`
- **THEN** the utility class SHALL override the base padding because `@layer system` has higher precedence than `@layer base`

#### Scenario: No systemPropMap provided (no system props)
- **WHEN** `createComponent('span', 'animus-Label-abc', { states: ['active'] })` is called without a 4th argument
- **THEN** the component SHALL render normally with variant/state resolution only — no system prop resolution attempted

#### Scenario: systemPropNames filters DOM props
- **WHEN** config has `{ systemPropNames: ["p", "mt"] }` and component is rendered with `p={8} mt={4} onClick={fn}`
- **THEN** only `onClick` SHALL be forwarded to the DOM — `p` and `mt` are filtered regardless of whether they matched in the shared map

### Requirement: Ref forwarding
The component returned by `createComponent` SHALL forward refs to the underlying DOM element.

#### Scenario: Forward ref
- **WHEN** a ref is passed to the component via `ref={myRef}`
- **THEN** `myRef.current` SHALL reference the underlying DOM element (e.g., the `<button>` element)

### Requirement: Prop filtering includes all prop types
The component SHALL NOT forward variant props, state props, system prop names, or custom prop names to the underlying DOM element. System prop names SHALL be sourced from the per-component `config.systemPropNames` array. When the `element` is a React component (not an HTML tag), ALL props except filtered ones SHALL be forwarded (no `isPropValid` check needed for component elements).

#### Scenario: Filter props with HTML tag element
- **WHEN** element is `'button'` and props include `variant="fill"`, `p={8}`, `onClick={fn}`
- **THEN** only `onClick` SHALL be forwarded to the DOM (variant and system prop filtered)

#### Scenario: Forward props to component element
- **WHEN** element is `NextLink` (a React component) and props include `href="/page"`, `variant="fill"`, `p={8}`
- **THEN** `href="/page"` SHALL be forwarded to NextLink, but `variant` and `p` SHALL still be filtered

#### Scenario: Merge external className
- **WHEN** component is rendered with `className="extra"`
- **THEN** the DOM element SHALL have class `"animus-Btn-x7f2 extra"` (external className appended)

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
