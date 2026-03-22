## ADDED Requirements

### Requirement: Variant value collection at JSX callsites
The JSX scanner SHALL collect variant prop values from JSX attributes when the attribute name matches a known variant prop for the matched component. It SHALL handle string literals, JSX string values, and dynamic expressions.

#### Scenario: Static variant value
- **WHEN** component `Button` has variant prop `variant` and a callsite has `<Button variant="stroke" />`
- **THEN** the scanner SHALL collect `{ component: "Button", variant_prop: "variant", value: "stroke" }`

#### Scenario: Dynamic variant value
- **WHEN** a callsite has `<Button variant={selectedVariant} />`
- **THEN** the scanner SHALL collect `{ component: "Button", variant_prop: "variant", value: "__dynamic__" }` indicating all options should be transacted IN

#### Scenario: Variant prop absent
- **WHEN** a callsite has `<Button />` and Button has variant prop `variant` with `defaultVariant: "fill"`
- **THEN** the scanner SHALL collect `{ component: "Button", variant_prop: "variant", value: "__default__" }` indicating the default option is implicitly used

### Requirement: State activation collection at JSX callsites
The JSX scanner SHALL collect state prop activations from JSX attributes when the attribute name matches a known state name for the matched component.

#### Scenario: Static boolean state
- **WHEN** component `Layout` has state `sidebar` and a callsite has `<Layout sidebar />`
- **THEN** the scanner SHALL collect `{ component: "Layout", state: "sidebar" }`

#### Scenario: Dynamic boolean state
- **WHEN** a callsite has `<Layout loading={isLoading} />`
- **THEN** the scanner SHALL collect `{ component: "Layout", state: "loading" }` — presence means used regardless of value

#### Scenario: State prop not present
- **WHEN** no callsite passes `loading` to `Layout`
- **THEN** the scanner SHALL NOT collect any `loading` state usage for `Layout`

### Requirement: Component render tracking at JSX callsites
The JSX scanner SHALL record which component bindings appear as JSX element tags, indicating the component is rendered in that file.

#### Scenario: Component used as JSX element
- **WHEN** a file contains `<GridBox>...</GridBox>`
- **THEN** the scanner SHALL record `GridBox` as a rendered component

#### Scenario: Component imported but not rendered
- **WHEN** a file imports `GridBox` but never uses it as a JSX element
- **THEN** the scanner SHALL NOT record `GridBox` as rendered
