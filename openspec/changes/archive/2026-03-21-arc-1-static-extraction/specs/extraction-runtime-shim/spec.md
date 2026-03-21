## ADDED Requirements

### Requirement: createComponent factory
The runtime shim SHALL export `createComponent(tag, className, config)` which returns a `React.forwardRef` component. The `tag` is an HTML element string. The `className` is the base extracted class name. The `config` describes variant and state props for className toggling.

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

### Requirement: Ref forwarding
The component returned by `createComponent` SHALL forward refs to the underlying DOM element.

#### Scenario: Forward ref
- **WHEN** a ref is passed to the component via `ref={myRef}`
- **THEN** `myRef.current` SHALL reference the underlying DOM element (e.g., the `<button>` element)

### Requirement: Prop filtering
The component SHALL NOT forward variant props, state props, or config-defined props to the underlying DOM element. All other props (including `children`, `className`, `style`, event handlers, ARIA attributes, and data attributes) SHALL be forwarded.

#### Scenario: Filter variant prop
- **WHEN** component is rendered with `variant="fill" onClick={handler}`
- **THEN** the DOM element SHALL have `onClick` but SHALL NOT have a `variant` attribute

#### Scenario: Filter state prop
- **WHEN** component is rendered with `loading={true} aria-busy="true"`
- **THEN** the DOM element SHALL have `aria-busy` but SHALL NOT have a `loading` attribute

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
