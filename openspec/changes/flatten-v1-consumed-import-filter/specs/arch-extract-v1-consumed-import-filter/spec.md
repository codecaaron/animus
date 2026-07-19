## ADDED Requirements

### Requirement: Flat private consumed-import decision

The V1 transform emitter SHALL route conservative named-import removal through
one private, engine-local decision while preserving source line shape.

#### Scenario: Conservative import matrix remains stable

- **WHEN** fully consumed, partially consumed, non-target, and import-looking
  non-import lines are filtered from source without a trailing newline
- **THEN** `consumed_import_filter_preserves_line_matrix` SHALL pass
- **AND** the G1 public-boundary diff check from `design.md` SHALL return empty

#### Scenario: Removal routing remains flat and engine-local

- **WHEN** the V1 removal decision is separated from the source loop
- **THEN** G2 SHALL find one private definition and one production call with no
  old three-deep decision shape
- **AND** the G4 V2 assembly hash SHALL remain exact
- **AND** mapped V1 Clippy, Rust-unit, NAPI-canary, and integration commands
  SHALL exit zero
