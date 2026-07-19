## ADDED Requirements

### Requirement: Isolated byte-stable V1 scale resolution

V1 scale lookup SHALL remain behind one private helper while preserving exact
scale outcomes and the surrounding resolver boundaries.

#### Scenario: Scale policy has one private owner

- **WHEN** the extraction is complete
- **THEN** the three G2 commands in `design.md` SHALL report `1`, `2`, and `0`
- **AND** the G1 public-boundary command SHALL return empty output

#### Scenario: Existing scale outcomes remain exact

- **WHEN** absent, theme, inline-object, empty-array, non-empty-array, and
  unsupported-key cases are resolved
- **THEN** the focused G3 direct-output and helper-state matrices SHALL pass two
  tests

#### Scenario: Surrounding V1 stages and delivery remain stable

- **WHEN** the private scale helper is reviewed
- **THEN** the three G4 marker-bounded checks SHALL return the exact SHA-256
  hashes recorded in `design.md`
- **AND** the G5 foreign-diff hash SHALL remain exact
- **AND** every G6 mapped verification command SHALL exit zero
