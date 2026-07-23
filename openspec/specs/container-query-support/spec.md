# container-query-support Specification

## Purpose
TBD - created by archiving change modern-css-surface. Update Purpose after archive.
## Requirements
### Requirement: Container condition block emission

Style objects SHALL accept raw `@container` condition strings as block keys, and each such block SHALL emit a `@container` rule wrapping the component's class selector inside the same `@layer` block that owns the component's base rule.

#### Scenario: Basic container condition

- **WHEN** a style object contains `'@container (min-width: 400px)': { fontSize: '18px' }`
- **THEN** the emitted CSS contains `@container (min-width: 400px) { .ClassName { font-size: 18px; } }`
- **AND** the `@container` rule appears inside the same `@layer` block as the component's base rule

#### Scenario: Token and shorthand resolution inside container blocks

- **WHEN** a style object contains `'@container (min-width: 400px)': { bg: 'primary', p: 16 }`
- **THEN** the emitted container rule contains `background-color: var(--color-primary)` and `padding: 1rem`

#### Scenario: No rule emitted for empty container block

- **WHEN** a style object contains `'@container (min-width: 400px)': {}`
- **THEN** no `@container` rule is emitted for that key

### Requirement: Named container conditions

Container condition keys SHALL support an optional container name, and the name SHALL be preserved verbatim in the emitted at-rule prelude.

#### Scenario: Named container query

- **WHEN** a style object contains `'@container card (min-width: 400px)': { display: 'grid' }`
- **THEN** the emitted CSS contains `@container card (min-width: 400px) { ... }`

### Requirement: Container establishment via declarations

Container establishment properties SHALL be accepted as ordinary style declarations: `containerType`, `containerName`, and the `container` shorthand SHALL emit their corresponding CSS declarations on the establishing element's rule.

#### Scenario: Establishing a named container

- **WHEN** a style object contains `{ containerType: 'inline-size', containerName: 'card' }`
- **THEN** the emitted base rule contains `container-type: inline-size;` and `container-name: card;`

#### Scenario: Container shorthand

- **WHEN** a style object contains `{ container: 'card / inline-size' }`
- **THEN** the emitted base rule contains `container: card / inline-size;`

### Requirement: Container conditions compose with selector blocks

Container condition blocks SHALL admit nested selector-alias and raw-selector blocks, and the emitted rule SHALL nest the composed selector inside the `@container` at-rule.

#### Scenario: Selector alias inside a container block

- **WHEN** a style object contains `'@container (min-width: 400px)': { _hover: { bg: 'primary' } }`
- **THEN** the emitted CSS contains `@container (min-width: 400px) { .ClassName:hover { background-color: var(--color-primary); } }`

### Requirement: Container-relative units on scale-typed properties

Strict scale-typed props (props bound to a token scale without `strict: false`) SHALL accept the six container-relative length units — `cqw`, `cqi`, `cqh`, `cqb`, `cqmin`, `cqmax` — as string values carrying a numeric prefix, at the type level, in both plain and responsive-value-map positions, and each such value SHALL be emitted verbatim. Admission SHALL NOT widen a strict scale prop to arbitrary strings: only these six unit suffixes with a numeric prefix are accepted; other unit strings and bare (numberless) suffixes SHALL remain rejected, and scale keys SHALL continue to resolve.

#### Scenario: Container unit on a strict scale prop

- **WHEN** a style object contains `p: '2cqi'` on a strict space-scale prop
- **THEN** the style object typechecks
- **AND** the emitted CSS contains `padding: 2cqi;` (the unit string emitted verbatim)

#### Scenario: Container unit in a responsive-map slot

- **WHEN** a style object contains `p: { _: 8, sm: '2cqi' }` on a strict space-scale prop
- **THEN** the style object typechecks, with the scale key `8` resolving to its token value and `2cqi` carried into the `sm` slot verbatim

#### Scenario: Non-container unit string rejected

- **WHEN** a style object contains `p: '2vw'` on a strict space-scale prop
- **THEN** the style object fails to typecheck (viewport units are not admitted; strictness is preserved)

#### Scenario: Bare container-unit suffix rejected

- **WHEN** a style object contains `p: 'cqi'` (no numeric part) on a strict space-scale prop
- **THEN** the style object fails to typecheck

### Requirement: Registered container condition aliases

Condition aliases registered with a `@container` value SHALL resolve as block keys to the registered container condition.

#### Scenario: Container alias in a style object

- **WHEN** the system is configured with `.addConditions({ _cardSm: '@container card (min-width: 400px)' })` and a style object contains `_cardSm: { display: 'grid' }`
- **THEN** the emitted CSS contains `@container card (min-width: 400px) { .ClassName { display: grid; } }`

