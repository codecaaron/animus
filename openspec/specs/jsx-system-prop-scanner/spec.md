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
The JSX scanner SHALL output a deduplicated list of static `(prop_name, value, component_binding)` tuples AND a deduplicated list of dynamic `(prop_name, component_binding)` tuples. Static deduplication SHALL be by (prop_name, value). Dynamic deduplication SHALL be by prop_name — a prop is either dynamic or not, regardless of how many dynamic usages exist.

#### Scenario: Deduplication across elements (static — unchanged)
- **WHEN** the file contains `<Box p={8} />` and `<Text p={8} />`
- **THEN** the static output SHALL contain a single entry for `(p, 8)`, not two

#### Scenario: Dynamic deduplication across files
- **WHEN** file A contains `<Box p={x} />` and file B contains `<Box p={y} />`
- **THEN** the dynamic output SHALL contain a single entry for prop `p` — not two

#### Scenario: Same prop both static and dynamic
- **WHEN** a file contains `<Box p={8} />` and `<Box p={variable} />`
- **THEN** the static output SHALL contain `(p, 8)` AND the dynamic output SHALL contain `(p)` — both outputs are populated

#### Scenario: Different values are distinct
- **WHEN** the file contains `<Box p={8} />` and `<Box p={16} />`
- **THEN** the output SHALL contain two entries: `(p, 8)` and `(p, 16)`

#### Scenario: Responsive values are distinct from scalar values
- **WHEN** the file contains `<Box mt={8} />` and `<Box mt={{ _: 8, sm: 16 }} />`
- **THEN** the output SHALL contain two entries: `(mt, 8)` and `(mt, { _: 8, sm: 16 })` — these are different values producing different utility classes

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
