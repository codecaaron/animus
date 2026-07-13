# Delta — style-witness-recording

## ADDED Requirements

### Requirement: Dev-mode resolution witness buffer

In development builds, every class-resolution outcome for variant, state, and system/custom
props SHALL append a witness record to an in-page buffer. Each record SHALL contain: the
component base class name, the prop name, the serialized value key, and the outcome —
one of `static` (utility/variant class matched), `dynamic` (CSS-variable slot path
taken), or `drop` (neither matched).

#### Scenario: Static resolution witnessed

- **WHEN** a development build resolves `p={8}` to a utility class
- **THEN** the buffer gains a record `(baseClassName, "p", "8", "static")`

#### Scenario: Dynamic resolution witnessed

- **WHEN** a development build resolves `p={someRuntimeValue}` through the CSS-variable
  slot path
- **THEN** the buffer gains a record with outcome `dynamic` carrying the serialized value

#### Scenario: Drop witnessed

- **WHEN** a development build encounters a value with no static class and no dynamic
  configuration
- **THEN** the buffer gains a record with outcome `drop`

### Requirement: Documented retrieval handle

The witness buffer SHALL be reachable at a single documented global handle so tooling
and tests can read the accumulated records without importing package internals.

#### Scenario: Reading the buffer

- **WHEN** a development page has rendered animus components
- **THEN** reading the documented global handle yields the ordered witness records

### Requirement: Bounded buffer

The witness buffer SHALL be bounded by a fixed capacity; once full, the oldest records
are discarded first. Long-running development sessions SHALL NOT grow memory unboundedly
through witness recording.

#### Scenario: Capacity respected

- **WHEN** more records than the capacity have been appended
- **THEN** the buffer length equals the capacity and the earliest records are absent

### Requirement: Production exclusion

Production builds SHALL contain no witness-recording code and no witness global handle.

#### Scenario: Production bundle carries no recorder

- **WHEN** the showcase application is built in production mode
- **THEN** the emitted JS bundles contain no occurrence of the witness token string
