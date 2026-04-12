## MODIFIED Requirements

### Requirement: Stylesheet assembly produces correct cascade ordering
The `assembleStylesheet` function SHALL return structured parts that enable callers to protect the `@layer` declaration and variable CSS from post-processing transforms that destructively rewrite CSS structure.

#### Scenario: Split return preserves declaration
- **WHEN** `assembleStylesheet` is called with `layers`, `variableCss`, `globalCss`, and `componentCss`
- **THEN** the returned `declaration` field SHALL contain the full `@layer` ordering statement followed by variable CSS
- **AND** the returned `body` field SHALL contain global CSS followed by component CSS
- **AND** neither field SHALL duplicate content from the other

#### Scenario: Declaration contains all layer names
- **WHEN** custom layers `['reset', 'anm-global', 'anm-base', ..., 'overrides']` are provided
- **THEN** the declaration SHALL contain `@layer reset, anm-global, anm-base, anm-variants, anm-compounds, anm-states, anm-system, anm-custom, overrides;`
- **AND** no layer name SHALL be omitted regardless of whether matching `@layer` blocks exist in the body

#### Scenario: Variable CSS preserved in declaration
- **WHEN** `variableCss` contains `:root { --color-primary: red; }` and `[data-color-mode="dark"] { --color-primary: blue; }`
- **THEN** the declaration field SHALL contain the variable CSS after the `@layer` statement
- **AND** the variable CSS SHALL NOT appear in the body field

## ADDED Requirements

### Requirement: Post-processing protects declaration and variables
The vite-plugin `load` hook SHALL NOT pass the `@layer` cascade declaration or variable CSS through Lightning CSS `transform()`.

#### Scenario: Prod mode stylesheet preserves declaration
- **WHEN** the virtual module `virtual:animus/styles.css` is loaded in prod mode
- **THEN** the output SHALL begin with the full `@layer` declaration statement
- **AND** variable CSS SHALL appear immediately after the declaration, before any `@layer` blocks
- **AND** the `@layer` block content (global + component CSS) SHALL be post-processed by Lightning CSS

#### Scenario: Dev mode stylesheet preserves declaration
- **WHEN** the virtual module is loaded in dev mode
- **THEN** the output SHALL begin with the full `@layer` declaration followed by variable CSS followed by global CSS
- **AND** Lightning CSS SHALL NOT reorder or strip any part of the declaration

#### Scenario: Dev mode adopted stylesheet strips declaration
- **WHEN** the component CSS is served via the adopted stylesheet bridge (dev HMR)
- **THEN** the `sheets.declaration` embedded in `resolvedComponentCss` SHALL be stripped before Lightning CSS processing
- **AND** the adopted stylesheet SHALL NOT contain a duplicate `@layer` declaration

### Requirement: Backward compatibility for assembleStylesheet consumers
The `assembleStylesheet` function SHALL maintain backward compatibility for existing consumers that expect a string return.

#### Scenario: Default call returns string
- **WHEN** `assembleStylesheet` is called without a `split` option
- **THEN** it SHALL return a single concatenated CSS string (declaration + variables + global + component)
- **AND** existing consumers (including next-plugin) SHALL continue to work without changes

#### Scenario: Split call returns structured parts
- **WHEN** `assembleStylesheet` is called with `{ split: true }` or equivalent option
- **THEN** it SHALL return `{ declaration: string, body: string }`
