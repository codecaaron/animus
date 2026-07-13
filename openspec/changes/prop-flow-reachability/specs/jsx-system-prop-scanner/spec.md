# Delta — jsx-system-prop-scanner

## MODIFIED Requirements

### Requirement: Static value evaluation

The JSX scanner SHALL evaluate JSX attribute values that are static literals (numbers,
strings) or static responsive objects (object expressions with only breakpoint keys and
literal values). Additionally:

1. **Resolution through project static values.** An identifier or member expression whose
   value resolves through the project's static-value resolution (local static consts,
   imported static exports, re-export chains) SHALL evaluate as a static usage carrying
   the resolved value.
2. **Enumerable-set expansion.** A conditional expression (`a ? x : y`) or logical
   expression (`x ?? y`, `x || y`) whose result alternatives are all statically evaluable
   SHALL produce an enumerable value set: each member is recorded as an observed static
   usage for the prop, and the site itself is additionally recorded as a dynamic usage so
   the CSS-variable slot remains available.

For attributes with values that are neither statically evaluable nor enumerable
(unresolvable identifiers, call expressions, dynamic-armed conditionals, or any other
non-literal AST node), the scanner SHALL emit a dynamic prop usage record instead of
skipping silently.

#### Scenario: Numeric literal

- **WHEN** a JSX attribute is `p={8}`
- **THEN** the scanner SHALL evaluate the value as the number `8` (static usage — unchanged)

#### Scenario: String literal

- **WHEN** a JSX attribute is `display="flex"` or `display={"flex"}`
- **THEN** the scanner SHALL evaluate the value as the string `"flex"` (static usage — unchanged)

#### Scenario: Responsive object with \_ key

- **WHEN** a JSX attribute is `mt={{ _: 8, sm: 16 }}`
- **THEN** the scanner SHALL evaluate the value as a responsive object `{ _: 8, sm: 16 }` (static usage — unchanged)

#### Scenario: Identifier resolved through static values

- **WHEN** a JSX attribute is `p={SPACING_LG}` and `SPACING_LG` resolves to the static
  value `24` through local or cross-file static-value resolution
- **THEN** the scanner SHALL evaluate the value as the number `24` (static usage)

#### Scenario: Member expression resolved through static values

- **WHEN** a JSX attribute is `p={Tokens.lg}` and `Tokens` resolves to a static object
  with `lg: 24`
- **THEN** the scanner SHALL evaluate the value as the number `24` (static usage)

#### Scenario: Unresolvable identifier detected as dynamic

- **WHEN** a JSX attribute is `p={spacing}` where `spacing` does not resolve through
  static-value resolution
- **THEN** the scanner SHALL emit a dynamic prop usage `(prop_name: "p", binding: "Box")` — NOT skip silently

#### Scenario: Static-armed conditional produces an enumerable set

- **WHEN** a JSX attribute is `display={isOpen ? 'block' : 'none'}`
- **THEN** the scanner SHALL record observed static usages for both `'block'` and
  `'none'` on `display`, and SHALL also emit a dynamic prop usage for the site

#### Scenario: Static-defaulted nullish coalescing produces an enumerable set

- **WHEN** a JSX attribute is `p={pad ?? 8}` and `pad` does not resolve statically
- **THEN** the scanner SHALL record an observed static usage for `8` on `p`, and SHALL
  also emit a dynamic prop usage for the site

#### Scenario: Dynamic-armed conditional detected as dynamic only

- **WHEN** a JSX attribute is `p={cond ? a : 8}` where `a` does not resolve statically
- **THEN** the scanner SHALL emit a dynamic prop usage for the site and SHALL NOT record
  enumerable members

#### Scenario: Skip spread attribute

- **WHEN** a JSX element has `{...props}` spread
- **THEN** the scanner SHALL skip the spread — spreads are neither static nor dynamic (unchanged)

#### Scenario: Function call detected as dynamic

- **WHEN** a JSX attribute is `p={getSpacing()}`
- **THEN** the scanner SHALL emit a dynamic prop usage `(prop_name: "p", binding: "Box")`

#### Scenario: Template literal with expressions detected as dynamic

- **WHEN** a JSX attribute is ``p={`${size}px`}``
- **THEN** the scanner SHALL emit a dynamic prop usage `(prop_name: "p", binding: "Box")`

#### Scenario: Template literal without expressions is static

- **WHEN** a JSX attribute is ``display={`flex`}``
- **THEN** the scanner SHALL evaluate the value as the string `"flex"` (static — no expression interpolation)

#### Scenario: Binary expression detected as dynamic

- **WHEN** a JSX attribute is `p={baseSize + 4}`
- **THEN** the scanner SHALL emit a dynamic prop usage `(prop_name: "p", binding: "Box")`

#### Scenario: Responsive object with any dynamic value detected as dynamic

- **WHEN** a JSX attribute is `mt={{ _: spacing, sm: 16 }}` and `spacing` does not
  resolve statically
- **THEN** the scanner SHALL emit a dynamic prop usage for `mt` — the entire responsive
  object is treated as dynamic if any value is non-static after resolution
