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
The JSX scanner SHALL evaluate JSX attribute values that are static literals (numbers, strings) or static responsive objects (object expressions with only breakpoint keys and literal values). It SHALL skip attributes with dynamic values.

#### Scenario: Numeric literal
- **WHEN** a JSX attribute is `p={8}`
- **THEN** the scanner SHALL evaluate the value as the number `8`

#### Scenario: String literal
- **WHEN** a JSX attribute is `display="flex"` or `display={"flex"}`
- **THEN** the scanner SHALL evaluate the value as the string `"flex"`

#### Scenario: Responsive object with _ key
- **WHEN** a JSX attribute is `mt={{ _: 8, sm: 16 }}`
- **THEN** the scanner SHALL evaluate the value as a responsive object `{ _: 8, sm: 16 }`

#### Scenario: Responsive object without _ key
- **WHEN** a JSX attribute is `position={{ sm: 'static' }}`
- **THEN** the scanner SHALL evaluate the value as a responsive object `{ sm: "static" }` (no default value)

#### Scenario: Skip identifier reference
- **WHEN** a JSX attribute is `p={spacing}` where `spacing` is an identifier
- **THEN** the scanner SHALL skip this attribute — it is not statically evaluable

#### Scenario: Skip spread attribute
- **WHEN** a JSX element has `{...props}` spread
- **THEN** the scanner SHALL skip the spread — any system props within it are not statically evaluable

#### Scenario: Skip function call
- **WHEN** a JSX attribute is `p={getSpacing()}`
- **THEN** the scanner SHALL skip this attribute

#### Scenario: Skip conditional expression
- **WHEN** a JSX attribute is `display={isOpen ? 'block' : 'none'}`
- **THEN** the scanner SHALL skip this attribute

### Requirement: Output structure
The JSX scanner SHALL output a deduplicated list of `(prop_name, value, component_binding)` tuples representing all static system prop usages found in the file. Deduplication SHALL be by (prop_name, value) — the same prop+value pair used across multiple elements or components produces one entry.

#### Scenario: Deduplication across elements
- **WHEN** the file contains `<Box p={8} />` and `<Text p={8} />`
- **THEN** the output SHALL contain a single entry for `(p, 8)`, not two

#### Scenario: Different values are distinct
- **WHEN** the file contains `<Box p={8} />` and `<Box p={16} />`
- **THEN** the output SHALL contain two entries: `(p, 8)` and `(p, 16)`

#### Scenario: Responsive values are distinct from scalar values
- **WHEN** the file contains `<Box mt={8} />` and `<Box mt={{ _: 8, sm: 16 }} />`
- **THEN** the output SHALL contain two entries: `(mt, 8)` and `(mt, { _: 8, sm: 16 })` — these are different values producing different utility classes
