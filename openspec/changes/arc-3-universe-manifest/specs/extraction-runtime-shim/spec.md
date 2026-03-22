## MODIFIED Requirements

### Requirement: createComponent factory
The runtime shim SHALL export `createComponent(element, className, config)` which returns a `React.forwardRef` component. The `element` parameter accepts EITHER an HTML tag string (e.g., `'button'`) OR a React component reference (for `.asComponent()` extensions). The `className` is the base extracted class name. The `config` describes variant props, state props, system prop class mappings, and the original chain configuration for `.extend()` support.

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

### Requirement: Extend method returns AnimusExtended
The component returned by `createComponent` SHALL have an `.extend()` method that returns an `AnimusExtended` instance from `@animus-ui/core`, seeded with the extracted component's original chain configuration. This enables runtime extension of extracted components.

#### Scenario: Extend an extracted component
- **WHEN** `Button.extend()` is called on an extracted component
- **THEN** it SHALL return an `AnimusExtended` instance that can chain `.styles()`, `.variant()`, `.states()`, `.groups()`, `.props()` and terminate with `.asElement()` or `.asComponent()`

#### Scenario: Extended component inherits parent config
- **WHEN** Button was extracted with `styles({ padding: 10 })` and `variant({ prop: 'size', variants: { sm: {...} } })` and `Button.extend().styles({ color: 'red' }).asElement('button')` is called at runtime
- **THEN** the resulting component SHALL have BOTH `padding: 10` (inherited) and `color: 'red'` (added) in its base styles, and the `size` variant SHALL be available

#### Scenario: Extend config in createComponent
- **WHEN** `createComponent('button', className, { ..., extendConfig: { propRegistry, groupRegistry, baseStyles, variants, statesConfig, activeGroups, custom } })` is called
- **THEN** the `.extend()` method SHALL use `extendConfig` to seed the AnimusExtended instance

### Requirement: Prop filtering includes all prop types
The component SHALL NOT forward variant props, state props, system prop names, or custom prop names to the underlying DOM element. When the `element` is a React component (not an HTML tag), ALL props except filtered ones SHALL be forwarded (no `isPropValid` check needed for component elements).

#### Scenario: Filter props with HTML tag element
- **WHEN** element is `'button'` and props include `variant="fill"`, `p={8}`, `onClick={fn}`
- **THEN** only `onClick` SHALL be forwarded to the DOM (variant and system prop filtered)

#### Scenario: Forward props to component element
- **WHEN** element is `NextLink` (a React component) and props include `href="/page"`, `variant="fill"`, `p={8}`
- **THEN** `href="/page"` SHALL be forwarded to NextLink, but `variant` and `p` SHALL still be filtered
