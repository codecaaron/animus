# typed-property-registration Specification

## Purpose
TBD - created by archiving change modern-css-surface. Update Purpose after archive.
## Requirements
### Requirement: Property registration emission for contextual vars

Contextual vars declared with registration metadata SHALL emit an `@property` rule for their custom property, containing the declared `syntax`, `inherits`, and `initial-value` descriptors. `@property` rules SHALL appear in the variables part of the assembled stylesheet, before any `@layer` block.

#### Scenario: Registered contextual var emits @property

- **WHEN** the theme chain declares a contextual var `'current-bg': '--current-bg'` with registration metadata `{ syntax: '<color>', inherits: true, initialValue: 'transparent' }`
- **THEN** the extracted CSS contains `@property --current-bg { syntax: "<color>"; inherits: true; initial-value: transparent; }`
- **AND** the `@property` rule appears in the variables part, before any `@layer` block

### Requirement: Property registration is opt-in

Custom properties without registration metadata SHALL NOT emit `@property` rules. Existing themes SHALL produce output without any `@property` rule.

#### Scenario: Unregistered contextual var unchanged

- **WHEN** the theme chain declares a contextual var without registration metadata
- **THEN** the extracted CSS contains no `@property` rule for that custom property

### Requirement: Registration metadata accepted at contextual var declaration

The theme builder's contextual var declaration method (`declareContextualVars`) SHALL accept optional per-var registration metadata (`syntax`, `inherits`, `initialValue`) alongside the existing declaration mapping, without changing the phantom type behavior of the declared var names. Registration metadata keys SHALL be constrained to the declared var names at the type level.

#### Scenario: Metadata does not alter type narrowing

- **WHEN** the theme chain calls `declareContextualVars` with registration metadata for `'current-bg'`
- **THEN** `'current-bg'` remains a literal-typed member of the target scale's keys
- **AND** the runtime theme object remains unchanged by the call

#### Scenario: Metadata keys constrained to declared names

- **WHEN** registration metadata names a var that was not declared in the same call
- **THEN** TypeScript produces a type error on that metadata key

