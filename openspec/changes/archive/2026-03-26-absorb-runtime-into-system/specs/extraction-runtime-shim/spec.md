## MODIFIED Requirements

### Requirement: createComponent factory
The runtime shim SHALL export `createComponent(element, className, config)` which returns a `React.forwardRef` component. The `element` parameter accepts EITHER an HTML tag string (e.g., `'button'`) OR a React component reference (for `.asComponent()` extensions). The `className` is the base extracted class name. The `config` describes variant props, state props, and system prop class mappings. The function SHALL be exported from `@animus-ui/system` (not `@animus-ui/runtime`).

#### Scenario: Render with HTML tag
- **WHEN** `createComponent('button', 'animus-Btn-x7f2', {})` creates a component and it is rendered
- **THEN** the rendered element SHALL be `<button class="animus-Btn-x7f2" />`

#### Scenario: Render with component reference
- **WHEN** `createComponent(NextLink, 'animus-Link-abc', {})` creates a component with a React component as the element
- **THEN** the rendered element SHALL be `<NextLink className="animus-Link-abc" />` — the component reference is used as the element type in `React.createElement`

#### Scenario: Import location
- **WHEN** extracted code needs the `createComponent` function
- **THEN** it SHALL import from `@animus-ui/system`, not `@animus-ui/runtime`
