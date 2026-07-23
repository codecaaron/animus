# supports-condition-blocks Specification

## Purpose
TBD - created by archiving change modern-css-surface. Update Purpose after archive.
## Requirements
### Requirement: Supports condition block emission

Style objects SHALL accept raw `@supports` condition strings as block keys, and each such block SHALL emit a `@supports` rule wrapping the component's class selector inside the owning `@layer` block, with full token and shorthand resolution inside the block.

#### Scenario: Basic supports condition

- **WHEN** a style object contains `'@supports (display: grid)': { display: 'grid', gap: 8 }`
- **THEN** the emitted CSS contains `@supports (display: grid) { .ClassName { display: grid; gap: 0.5rem; } }`
- **AND** the `@supports` rule appears inside the same `@layer` block as the component's base rule

#### Scenario: Negated supports condition

- **WHEN** a style object contains `'@supports not (backdrop-filter: blur(4px))': { bg: 'primary' }`
- **THEN** the emitted CSS contains `@supports not (backdrop-filter: blur(4px)) { .ClassName { background-color: var(--color-primary); } }`

### Requirement: Registered supports condition aliases

Condition aliases registered with a `@supports` value SHALL resolve as `_`-prefixed block keys to the registered supports condition.

#### Scenario: Supports alias in a style object

- **WHEN** the system is configured with `.addConditions({ _hasBackdrop: '@supports (backdrop-filter: blur(4px))' })` and a style object contains `_hasBackdrop: { backdropFilter: 'blur(4px)' }`
- **THEN** the emitted CSS contains `@supports (backdrop-filter: blur(4px)) { .ClassName { backdrop-filter: blur(4px); } }`

### Requirement: Supports conditions compose with selector blocks

Supports condition blocks SHALL admit nested selector-alias and raw-selector blocks, and the emitted rule SHALL nest the composed selector inside the `@supports` at-rule.

#### Scenario: Selector alias inside a supports block

- **WHEN** a style object contains `'@supports (display: grid)': { _hover: { gap: 12 } }`
- **THEN** the emitted CSS contains `@supports (display: grid) { .ClassName:hover { gap: 0.75rem; } }`

