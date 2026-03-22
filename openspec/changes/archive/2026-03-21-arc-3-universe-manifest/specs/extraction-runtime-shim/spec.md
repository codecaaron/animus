## MODIFIED Requirements

### Requirement: createComponent factory
The runtime shim SHALL export `createComponent(element, className, config)` which returns a `React.forwardRef` component. The `element` parameter accepts EITHER an HTML tag string (e.g., `'button'`) OR a React component reference (for `.asComponent()` extensions). The `className` is the base extracted class name. The `config` describes variant props, state props, and system prop class mappings.

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

### Requirement: Extend method directs to source-code extension
The component returned by `createComponent` SHALL have an `.extend()` method that throws an error directing the developer to use the builder API in source code. Extracted components cannot be runtime-extended because their configuration contains resolved CSS values, not the original Prop/Parser objects that AnimusExtended requires. Extensions MUST be authored in source code where the extraction pipeline can trace them at build time.

#### Scenario: Extend an extracted component throws
- **WHEN** `Button.extend()` is called on an extracted component at runtime
- **THEN** it SHALL throw an Error with a message explaining that extensions must be authored in source code using the builder API, so the extraction pipeline can resolve them at build time

#### Scenario: Source-code extension is extractable
- **WHEN** a developer writes `import { Button } from './Button'; const Primary = Button.extend().styles({...}).asElement('button')` in source code
- **THEN** the extraction pipeline SHALL resolve the extension at build time via the manifest (Arc 3), producing correct merged CSS without any runtime extension

### Requirement: Prop filtering includes all prop types
The component SHALL NOT forward variant props, state props, system prop names, or custom prop names to the underlying DOM element. When the `element` is a React component (not an HTML tag), ALL props except filtered ones SHALL be forwarded (no `isPropValid` check needed for component elements).

#### Scenario: Filter props with HTML tag element
- **WHEN** element is `'button'` and props include `variant="fill"`, `p={8}`, `onClick={fn}`
- **THEN** only `onClick` SHALL be forwarded to the DOM (variant and system prop filtered)

#### Scenario: Forward props to component element
- **WHEN** element is `NextLink` (a React component) and props include `href="/page"`, `variant="fill"`, `p={8}`
- **THEN** `href="/page"` SHALL be forwarded to NextLink, but `variant` and `p` SHALL still be filtered
