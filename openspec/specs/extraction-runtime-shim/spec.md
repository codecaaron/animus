### Requirement: createComponent factory
The runtime shim SHALL export `createComponent(tag, className, config)` which returns a `React.forwardRef` component. The `tag` is an HTML element string. The `className` is the base extracted class name. The `config` describes variant props, state props, and system prop class mappings for className assembly.

#### Scenario: Render base component
- **WHEN** `createComponent('button', 'animus-Btn-x7f2', {})` creates a component and it is rendered with no props
- **THEN** the rendered element SHALL be `<button class="animus-Btn-x7f2" />`

#### Scenario: Render with variant prop
- **WHEN** config is `{ variants: { variant: { options: ['fill', 'stroke'], default: 'fill' } } }` and component is rendered with `variant="stroke"`
- **THEN** the rendered element SHALL have class `"animus-Btn-x7f2 animus-Btn-x7f2--variant-stroke"`

#### Scenario: Render with state prop
- **WHEN** config is `{ states: ['loading', 'disabled'] }` and component is rendered with `loading={true}`
- **THEN** the rendered element SHALL have class `"animus-Btn-x7f2 animus-Btn-x7f2--loading"`

#### Scenario: Render with multiple active states
- **WHEN** component is rendered with `loading={true} disabled={true}`
- **THEN** the rendered element SHALL have class `"animus-Btn-x7f2 animus-Btn-x7f2--loading animus-Btn-x7f2--disabled"`

#### Scenario: Default variant applied
- **WHEN** config has `{ variants: { variant: { options: ['fill', 'stroke'], default: 'fill' } } }` and component is rendered with no `variant` prop
- **THEN** the rendered element SHALL have class `"animus-Btn-x7f2 animus-Btn-x7f2--variant-fill"`

#### Scenario: Render with system prop (extracted value)
- **WHEN** config has `{ systemProps: { p: { "8": "animus-u-a1b2c3" } }, systemPropNames: ["p", "m", "mt"] }` and component is rendered with `p={8}`
- **THEN** the rendered element SHALL have class `"animus-Btn-x7f2 animus-u-a1b2c3"`

#### Scenario: Render with system prop (non-extracted value)
- **WHEN** config has `{ systemProps: { p: { "8": "animus-u-a1b2c3" } }, systemPropNames: ["p"] }` and component is rendered with `p={24}`
- **THEN** the rendered element SHALL have class `"animus-Btn-x7f2"` only — the value `24` has no matching utility class and SHALL be silently ignored

#### Scenario: Render with responsive system prop
- **WHEN** config has `{ systemProps: { mt: { "8|sm:16": "animus-u-d4e5f6" } }, systemPropNames: ["mt"] }` and component is rendered with `mt={{ _: 8, sm: 16 }}`
- **THEN** the rendered element SHALL have class `"animus-Btn-x7f2 animus-u-d4e5f6"`

#### Scenario: System prop overrides base style via layer
- **WHEN** component has base style `padding: 0` in `@layer base` and is rendered with `p={8}` producing utility class in `@layer system`
- **THEN** the utility class SHALL override the base padding because `@layer system` has higher precedence than `@layer base`

### Requirement: Ref forwarding
The component returned by `createComponent` SHALL forward refs to the underlying DOM element.

#### Scenario: Forward ref
- **WHEN** a ref is passed to the component via `ref={myRef}`
- **THEN** `myRef.current` SHALL reference the underlying DOM element (e.g., the `<button>` element)

### Requirement: Prop filtering
The component SHALL NOT forward variant props, state props, system prop names, or custom prop names to the underlying DOM element. All other props (including `children`, `className`, `style`, event handlers, ARIA attributes, and data attributes) SHALL be forwarded.

#### Scenario: Filter variant prop
- **WHEN** component is rendered with `variant="fill" onClick={handler}`
- **THEN** the DOM element SHALL have `onClick` but SHALL NOT have a `variant` attribute

#### Scenario: Filter state prop
- **WHEN** component is rendered with `loading={true} aria-busy="true"`
- **THEN** the DOM element SHALL have `aria-busy` but SHALL NOT have a `loading` attribute

#### Scenario: Filter system prop
- **WHEN** component config has `systemPropNames: ["p", "mt", "color"]` and component is rendered with `p={8} mt={16} color="primary" id="box"`
- **THEN** the DOM element SHALL have `id="box"` but SHALL NOT have `p`, `mt`, or `color` attributes

#### Scenario: Merge external className
- **WHEN** component is rendered with `className="extra"`
- **THEN** the DOM element SHALL have class `"animus-Btn-x7f2 extra"` (external className appended)

### Requirement: Extend method
The component returned by `createComponent` SHALL have an `.extend()` method that returns an `AnimusExtended` instance initialized with the extracted component's configuration, enabling the standard extension chain.

#### Scenario: Extend an extracted component
- **WHEN** `Button.extend()` is called on an extracted component
- **THEN** it SHALL return an `AnimusExtended` instance that can chain `.styles()`, `.variant()`, etc. and terminate with `.asElement()` or `.asComponent()`

### Requirement: Bundle size
The runtime shim package (`@animus-ui/runtime`) SHALL be less than 1KB gzipped, excluding React as a peer dependency.

#### Scenario: Measure bundle size
- **WHEN** the runtime package is built and gzip-compressed
- **THEN** the compressed size SHALL be under 1024 bytes

### Requirement: System prop value serialization for lookup
The runtime shim SHALL serialize system prop values to string keys for lookup in the class map. Numeric values SHALL be converted to their string representation. Responsive objects SHALL be serialized to a canonical string format that matches the extraction pipeline's key generation.

#### Scenario: Numeric value lookup key
- **WHEN** component receives `p={8}`
- **THEN** the runtime SHALL look up key `"8"` in `systemProps.p`

#### Scenario: String value lookup key
- **WHEN** component receives `color="primary"`
- **THEN** the runtime SHALL look up key `"primary"` in `systemProps.color`

#### Scenario: Responsive value lookup key
- **WHEN** component receives `mt={{ _: 8, sm: 16 }}`
- **THEN** the runtime SHALL serialize to a canonical key (e.g., `"_:8|sm:16"`) and look up in `systemProps.mt`
