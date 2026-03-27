## ADDED Requirements

### Requirement: JSX element scanning
The JSX scanner SHALL walk all JSX elements in a source file and match element tags against component bindings that have active groups from chain walking. For each matching element, it SHALL collect JSX attributes whose names match active group prop names.

#### Scenario: Match Box with system props
- **WHEN** chain walking produces a binding `Box` with active groups `{ space: true, layout: true }` and the file contains `<Box p={8} mt={16} display="flex" />`
- **THEN** the scanner SHALL collect `{ p: 8, mt: 16, display: "flex" }` as system prop usages for the `Box` binding

#### Scenario: No match for non-group props
- **WHEN** chain walking produces a binding `Button` with active groups `{ space: true }` and the file contains `<Button variant="fill" p={8} />`
- **THEN** the scanner SHALL collect `{ p: 8 }` only — `variant` is not a group prop and SHALL be ignored by the scanner

#### Scenario: Non-extracted component ignored
- **WHEN** the file contains `<SomeComponent p={8} />` but `SomeComponent` is not a binding from chain walking (e.g., imported from elsewhere)
- **THEN** the scanner SHALL not collect any system props from that element

#### Scenario: Same component used multiple times
- **WHEN** the file contains `<Box p={8} />` and `<Box p={16} mt={8} />`
- **THEN** the scanner SHALL collect all unique (prop, value) pairs: `{ p: 8 }, { p: 16 }, { mt: 8 }`

### Requirement: Static value evaluation
The JSX scanner SHALL evaluate JSX attribute values that are static literals (numbers, strings) or static responsive objects (object expressions with only breakpoint keys and literal values). For attributes with dynamic values (identifiers, call expressions, conditional expressions, or any non-literal AST node), it SHALL emit a dynamic prop usage record instead of skipping silently.

#### Scenario: Numeric literal
- **WHEN** a JSX attribute is `p={8}`
- **THEN** the scanner SHALL evaluate the value as the number `8` (static usage — unchanged)

#### Scenario: String literal
- **WHEN** a JSX attribute is `display="flex"` or `display={"flex"}`
- **THEN** the scanner SHALL evaluate the value as the string `"flex"` (static usage — unchanged)

#### Scenario: Responsive object with _ key
- **WHEN** a JSX attribute is `mt={{ _: 8, sm: 16 }}`
- **THEN** the scanner SHALL evaluate the value as a responsive object `{ _: 8, sm: 16 }` (static usage — unchanged)

#### Scenario: Identifier reference detected as dynamic
- **WHEN** a JSX attribute is `p={spacing}` where `spacing` is an identifier
- **THEN** the scanner SHALL emit a dynamic prop usage `(prop_name: "p", binding: "Box")` — NOT skip silently

#### Scenario: Skip spread attribute
- **WHEN** a JSX element has `{...props}` spread
- **THEN** the scanner SHALL skip the spread — spreads are neither static nor dynamic (unchanged)

#### Scenario: Function call detected as dynamic
- **WHEN** a JSX attribute is `p={getSpacing()}`
- **THEN** the scanner SHALL emit a dynamic prop usage `(prop_name: "p", binding: "Box")`

#### Scenario: Conditional expression detected as dynamic
- **WHEN** a JSX attribute is `display={isOpen ? 'block' : 'none'}`
- **THEN** the scanner SHALL emit a dynamic prop usage `(prop_name: "display", binding: "Box")`

#### Scenario: Member expression detected as dynamic
- **WHEN** a JSX attribute is `p={theme.spacing.large}`
- **THEN** the scanner SHALL emit a dynamic prop usage `(prop_name: "p", binding: "Box")`

#### Scenario: Template literal with expressions detected as dynamic
- **WHEN** a JSX attribute is `` p={`${size}px`} ``
- **THEN** the scanner SHALL emit a dynamic prop usage `(prop_name: "p", binding: "Box")`

#### Scenario: Template literal without expressions is static
- **WHEN** a JSX attribute is `` display={`flex`} ``
- **THEN** the scanner SHALL evaluate the value as the string `"flex"` (static — no expression interpolation)

#### Scenario: Binary expression detected as dynamic
- **WHEN** a JSX attribute is `p={baseSize + 4}`
- **THEN** the scanner SHALL emit a dynamic prop usage `(prop_name: "p", binding: "Box")`

#### Scenario: Responsive object with any dynamic value detected as dynamic
- **WHEN** a JSX attribute is `mt={{ _: spacing, sm: 16 }}`
- **THEN** the scanner SHALL emit a dynamic prop usage for `mt` — the entire responsive object is treated as dynamic if any value is non-static

### Requirement: Output structure

The scanner SHALL produce deduplicated output containing:
- **Static system prop usages**: `(prop_name, value, component_binding)` tuples — global, shared across all components
- **Dynamic system prop usages**: `(prop_name, component_binding)` tuples — global, deduplicated by prop_name
- **Static custom prop usages**: `(prop_name, value, component_binding)` tuples — per-component, scoped to the defining component
- **Dynamic custom prop usages**: `(prop_name, component_binding)` tuples — per-component, scoped to the defining component
- Variant value activations per component
- State activations per component
- Set of rendered component bindings

Custom prop usages SHALL be tracked separately from system prop usages. A custom prop is identified by membership in the component's `custom_prop_configs` — it appears in the custom props scan output, not the system props scan output.

Dynamic deduplication for custom props SHALL be scoped per-component: if component A and component B both define a `size` custom prop, their dynamic usages are tracked independently.

#### Scenario: System prop static output
- **WHEN** `<Box p={8} />` is scanned and `p` is a system prop
- **THEN** a static system prop usage `("p", "8", "Box")` is emitted

#### Scenario: Custom prop static output
- **WHEN** `<Card size="sm" />` is scanned and `size` is a custom prop on Card
- **THEN** a static custom prop usage `("size", "sm", "Card")` is emitted

#### Scenario: Custom prop dynamic output
- **WHEN** `<Card size={someVar} />` is scanned and `size` is a custom prop on Card
- **THEN** a dynamic custom prop usage `("size", "Card")` is emitted

#### Scenario: Same prop name on different components
- **WHEN** `<Card size="sm" />` and `<Button size={3} />` both use `size` as a custom prop
- **THEN** separate custom prop usages are emitted for each component binding

#### Scenario: Mixed system and custom prop on same element
- **WHEN** `<Card p={8} size="sm" />` where `p` is a system prop and `size` is a custom prop
- **THEN** `p` appears in system prop output and `size` appears in custom prop output

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

### Requirement: Per-component custom prop dynamic detection

The scanner SHALL detect dynamic usage of custom props using the same detection rules as system props: identifier references, call expressions, conditional expressions, member expressions, template literals with expressions, and binary expressions.

Custom prop dynamic detection SHALL be scoped to the component that defines the custom prop. The scanner uses the `global_custom_props` map (binding → set of custom prop names) to determine which props are custom for each component.

#### Scenario: Custom prop identifier detected as dynamic
- **WHEN** `<Card size={mySize} />` is scanned and `size` is a custom prop on Card
- **THEN** a dynamic custom prop usage is recorded for Card's `size` prop

#### Scenario: Custom prop conditional detected as dynamic
- **WHEN** `<Card size={isLarge ? "lg" : "sm"} />` is scanned
- **THEN** a dynamic custom prop usage is recorded (conditional = dynamic, even with literal branches)

#### Scenario: Custom prop static value not marked dynamic
- **WHEN** `<Card size="sm" />` is scanned with a string literal value
- **THEN** only a static custom prop usage is recorded, no dynamic usage
