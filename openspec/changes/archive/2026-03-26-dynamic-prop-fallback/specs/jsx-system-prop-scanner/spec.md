## MODIFIED Requirements

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
