## MODIFIED Requirements

### Requirement: createComponent factory
The runtime shim SHALL export `createComponent(element, className, config)` which returns a plain function component that accepts `ref` as a regular prop (React 19 ref-as-prop pattern). The `element` parameter accepts EITHER an HTML tag string (e.g., `'button'`) OR a React component reference (for `.asComponent()` extensions). The `className` is the base extracted class name. The `config` describes variant props, state props, and system prop class mappings.

#### Scenario: Render with HTML tag
- **WHEN** `createComponent('button', 'animus-Btn-x7f2', {})` creates a component and it is rendered
- **THEN** the rendered element SHALL be `<button class="animus-Btn-x7f2" />`

#### Scenario: Render with component reference
- **WHEN** `createComponent(NextLink, 'animus-Link-abc', {})` creates a component with a React component as the element
- **THEN** the rendered element SHALL be `<NextLink className="animus-Link-abc" />` — the component reference is used as the element type in `React.createElement`

#### Scenario: Render with variant prop
- **WHEN** config has variants and component is rendered with `variant="stroke"`
- **THEN** the rendered element SHALL have the variant modifier class appended

#### Scenario: Render with system prop
- **WHEN** config has `systemProps` and component is rendered with `p={8}`
- **THEN** the rendered element SHALL have the utility class appended

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
The component returned by `createComponent` SHALL forward refs to the underlying DOM element via React 19 ref-as-prop pattern. The `ref` prop SHALL be destructured from props and passed directly to `createElement`.

#### Scenario: Forward ref via prop
- **WHEN** a ref is passed to the component via `ref={myRef}`
- **THEN** `myRef.current` SHALL reference the underlying DOM element (e.g., the `<button>` element)

#### Scenario: No forwardRef wrapper
- **WHEN** `createComponent` constructs the component function
- **THEN** the function SHALL NOT be wrapped in `React.forwardRef` — ref is received as a regular prop
