# nested-selector-resolution Specification

## Purpose
TBD - created by archiving change modern-css-surface. Update Purpose after archive.
## Requirements
### Requirement: Multi-level selector nesting resolves by parent composition

Selector blocks nested inside other selector blocks SHALL resolve by composing the inner selector against the outer composed selector, with `&` referring to the outer composition. Content past one level of nesting SHALL emit under its fully composed selector rather than flattening into the parent's declarations.

#### Scenario: Alias nested inside an alias

- **WHEN** a style object contains `_hover: { _before: { opacity: 1 } }`
- **THEN** the emitted CSS contains a rule for `.ClassName:hover::before` containing `opacity: 1`
- **AND** the declaration does NOT appear directly in the `.ClassName:hover` rule

#### Scenario: Raw descendant selector with nested alias

- **WHEN** a style object contains `'& .icon': { _hover: { color: 'primary' } }`
- **THEN** the emitted CSS contains a rule for `.ClassName .icon:hover` containing `color: var(--color-primary)`

#### Scenario: Alias with nested descendant selector

- **WHEN** a style object contains `_hover: { '& .icon': { color: 'primary' } }`
- **THEN** the emitted CSS contains a rule for `.ClassName:hover .icon` containing `color: var(--color-primary)`

### Requirement: Single-level nesting output shape preserved

Style objects whose selector nesting is at most one level deep SHALL emit the same rule structure as they do without multi-level resolution: one rule per composed selector, in the same cascade order.

#### Scenario: One-level alias unchanged

- **WHEN** a style object contains `_hover: { bg: 'primary' }` and no deeper nesting
- **THEN** the emitted CSS contains exactly one `.ClassName:hover` rule with `background-color: var(--color-primary)`

### Requirement: Conditions and selectors nest in both orders

Condition blocks SHALL be accepted inside selector blocks and selector blocks inside condition blocks. In both authoring orders, the emitted at-rule SHALL wrap the rule for the fully composed selector.

#### Scenario: Condition inside a selector block

- **WHEN** a style object contains `_hover: { '@container (min-width: 400px)': { gap: 8 } }`
- **THEN** the emitted CSS contains `@container (min-width: 400px) { .ClassName:hover { gap: 0.5rem; } }`

#### Scenario: Responsive value map inside a condition block

- **WHEN** a style object contains `'@container (min-width: 400px)': { fontSize: { _: '14px', sm: '16px' } }`
- **THEN** the emitted CSS contains, inside the `@container` block, `.ClassName { font-size: 14px; }` followed by the `sm` min-width media rule containing `font-size: 16px`
- **AND** the breakpoint media rule nests inside the `@container` block, never the reverse

#### Scenario: Stacked conditions wrap outermost-first

- **WHEN** a style object contains `'@supports (display: grid)': { '@container (min-width: 400px)': { display: 'grid' } }`
- **THEN** the emitted CSS contains `@supports (display: grid) { @container (min-width: 400px) { .ClassName { display: grid; } } }`

### Requirement: Deterministic ordering of nested rules

Rules produced by nested selector resolution SHALL emit in a deterministic order: composed selectors are ordered by the OUTER selector segment's cascade position (known pseudo heads follow the existing selector cascade order regardless of authoring order); composed selectors sharing the same outer segment, and those with unrecognized outer segments, keep authoring order.

#### Scenario: Nested rules follow outer cascade order

- **WHEN** a style object contains `_active: { _before: { opacity: 0.5 } }` followed by `_hover: { _before: { opacity: 1 } }`
- **THEN** the `.ClassName:hover::before` rule emits before the `.ClassName:active::before` rule, regardless of the authoring order

