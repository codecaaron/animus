## MODIFIED Requirements

### Requirement: Compose options configuration

`compose()` SHALL accept a slots record and an options object with `shared` (variant propagation config) and optional `name` (display name prefix). The `context` option SHALL NOT exist on `compose()`. Context-based propagation SHALL be accessed via a separate `composeWithContext()` function.

#### Scenario: compose with shared variants
- **WHEN** `compose({ Root, Child }, { shared: { size: true }, name: "Card" })` is called
- **THEN** the family is created with CSS-only shared variant propagation and displayNames prefixed with "Card"

#### Scenario: compose rejects context option
- **WHEN** `compose({ Root, Child }, { shared: { size: true }, context: true })` is called
- **THEN** TypeScript reports a type error for the `context` property

## ADDED Requirements

### Requirement: composeWithContext function

`composeWithContext()` SHALL accept the same slots record and options shape as `compose()` (minus `context`). It SHALL create a React context for shared variant propagation. Root SHALL provide shared values, children SHALL consume via `useContext`, and direct props on children SHALL override context values.

#### Scenario: composeWithContext propagates via context
- **WHEN** `composeWithContext({ Root, Child }, { shared: { size: true } })` is used and Root receives `size="sm"`
- **THEN** Child receives `size="sm"` via React context and applies the corresponding variant class

#### Scenario: Direct props override context
- **WHEN** Root provides `size="sm"` via context and Child receives `size="lg"` as a direct prop
- **THEN** Child uses `size="lg"` (direct prop wins)
