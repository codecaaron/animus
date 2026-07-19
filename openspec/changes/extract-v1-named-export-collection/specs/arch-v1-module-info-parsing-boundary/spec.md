## ADDED Requirements

### Requirement: Isolated behavior-stable V1 named-export collection

V1 named-export collection SHALL remain behind one private helper while
preserving exact module metadata and adjacent parsing boundaries.

#### Scenario: Named-export policy has one private owner

- **WHEN** the extraction is complete
- **THEN** the three G2 commands in `design.md` SHALL report `1`, `2`, and `0`
- **AND** the G1 public-boundary command SHALL return empty output and manual
  target review SHALL find no multiline public-signature change

#### Scenario: Existing named-export outcomes remain exact

- **WHEN** local, renamed, re-exported, ordered multiple-specifier,
  declaration-backed, and multiple-declaration named exports are parsed
- **THEN** the focused G3 ordered-field matrix SHALL pass one test before and
  after extraction

#### Scenario: Adjacent V1 policy and delivery remain stable

- **WHEN** the private helper is reviewed
- **THEN** the three G4 checks and G5 foreign-patch check SHALL return the exact
  SHA-256 hashes recorded in `design.md`
- **AND** G7 SHALL return the exact normalized formatter diagnostic hash
- **AND** every G6 mapped verification command SHALL exit zero

### Requirement: Behavior-stable V1 declaration-export construction

V1 declaration-backed exports SHALL construct local `ExportInfo` values
through one private owner while retaining exact supported and intentionally
ignored declaration coverage.

#### Scenario: Runtime declaration metadata remains exact

- **WHEN** multiple variable declarators and named function/class declarations
  are parsed
- **THEN** G9 SHALL preserve their exact ordered `exported_name`, `local_name`,
  `source`, and `is_default` fields

#### Scenario: Unsupported declaration bindings stay ignored

- **WHEN** destructuring, interface, or type-alias exports are parsed
- **THEN** G9 SHALL produce no declaration-backed `ExportInfo` values

#### Scenario: Declaration construction has one private owner

- **WHEN** increment 04 is complete
- **THEN** G8 SHALL report `1`, `4`, and `0`
- **AND** G10/G11, G1, G5, G7, and the mapped G6 chain SHALL remain exact
