## Requirements

### Requirement: Stylesheet assembly produces structured parts for selective post-processing
The `assembleStylesheet` function SHALL support a `split` option that returns structured parts enabling callers to protect the `@layer` declaration and variable CSS from post-processing transforms that destructively rewrite CSS structure. The three-part split separates declaration, variables, and body so that only body content (which benefits from autoprefixing) passes through CSS post-processors.

#### Scenario: Split return provides three parts
- **WHEN** `assembleStylesheet` is called with `{ split: true }` along with `layers`, `variableCss`, `globalCss`, and `componentCss`
- **THEN** it SHALL return `{ declaration: string; variables: string; body: string }`
- **AND** `declaration` SHALL contain only the `@layer` ordering statement
- **AND** `variables` SHALL contain only the variable CSS (`:root` blocks + color mode selectors)
- **AND** `body` SHALL contain global CSS followed by component CSS
- **AND** no content SHALL be duplicated across the three parts

#### Scenario: Declaration contains all layer names
- **WHEN** custom layers `['reset', 'anm-global', 'anm-base', ..., 'overrides']` are provided
- **THEN** the declaration SHALL contain `@layer reset, anm-global, anm-base, anm-variants, anm-compounds, anm-states, anm-system, anm-custom, overrides;`
- **AND** no layer name SHALL be omitted regardless of whether matching `@layer` blocks exist in the body

#### Scenario: Variable CSS isolated from body
- **WHEN** `variableCss` contains `:root { --color-primary: red; }` and `[data-color-mode="dark"] { --color-primary: blue; }`
- **THEN** `variables` SHALL contain the full variable CSS
- **AND** `body` SHALL NOT contain any `:root` variable declarations or color mode selectors

#### Scenario: Body strips embedded layer declaration from component CSS
- **WHEN** component CSS from Rust contains an embedded `@layer ...;` declaration line
- **THEN** the `body` field SHALL have that declaration stripped (via `stripLeadingLayerDeclaration`)
- **AND** only the `declaration` field SHALL contain the `@layer` ordering statement

#### Scenario: Concatenated split equals non-split return
- **WHEN** `assembleStylesheet` is called with identical options, once with `split: true` and once without
- **THEN** joining `declaration + '\n' + variables + '\n' + body` from the split form SHALL produce the same content as the non-split string return

### Requirement: Backward compatibility for assembleStylesheet consumers
The `assembleStylesheet` function SHALL maintain backward compatibility for existing consumers that expect a string return.

#### Scenario: Default call returns string
- **WHEN** `assembleStylesheet` is called without a `split` option
- **THEN** it SHALL return a single concatenated CSS string (declaration + variables + global + component)
- **AND** existing consumers SHALL continue to work without changes
