## MODIFIED Requirements

### Requirement: Component render tracking at JSX callsites
The JSX scanner SHALL record which component bindings are rendered in a file. A component is considered rendered when it appears in any of the following forms:
- As a JSX element tag (`<GridBox />` or `<GridBox>...</GridBox>`)
- As a JSX member-expression tag (`<DrawerSlots.Overlay />`)
- As the first argument of a `React.createElement(...)` or `createElement(...)` CallExpression, where the first argument is a bare identifier (`createElement(CloseButton, ...)`) or a member expression (`createElement(DrawerSlots.Overlay, ...)`)

String literals as the first argument of `createElement(...)` (native DOM tags) SHALL NOT be recorded. Non-literal, non-identifier, non-member-expression first arguments (e.g. call expressions) SHALL NOT be recorded — they resolve to dynamic components the scanner cannot attribute to a known binding.

#### Scenario: Component used as JSX element
- **WHEN** a file contains `<GridBox>...</GridBox>`
- **THEN** the scanner SHALL record `GridBox` as a rendered component

#### Scenario: Component used as JSX member expression
- **WHEN** a file contains `<DrawerSlots.Overlay />`
- **THEN** the scanner SHALL record `DrawerSlots.Overlay` as a rendered component

#### Scenario: Component imported but not rendered
- **WHEN** a file imports `GridBox` but never uses it as a JSX element nor passes it to `createElement`
- **THEN** the scanner SHALL NOT record `GridBox` as rendered

#### Scenario: Component rendered via createElement with bare identifier
- **WHEN** a file contains `createElement(CloseButton, { onClick })` or `React.createElement(CloseButton, props, children)`
- **THEN** the scanner SHALL record `CloseButton` as a rendered component

#### Scenario: Component rendered via createElement with member expression
- **WHEN** a file contains `createElement(DrawerSlots.Overlay, props, children)`
- **THEN** the scanner SHALL record `DrawerSlots.Overlay` as a rendered component — identical attribution to the JSX member-expression form

#### Scenario: createElement with native DOM tag string literal
- **WHEN** a file contains `createElement('div', props, children)`
- **THEN** the scanner SHALL NOT record any component binding — string literals are native DOM elements, not ds-built components

#### Scenario: createElement with dynamic first argument
- **WHEN** a file contains `createElement(getComponent(), props)` or `createElement(condition ? A : B, props)`
- **THEN** the scanner SHALL NOT record any component binding — call expressions and conditional expressions resolve to dynamic components the scanner cannot attribute
