## ADDED Requirements

### Requirement: Flat V1 object-source routing

The V1 extraction bridge SHALL route object-source shapes through one flat,
engine-local decision while preserving helper outputs and diagnostics.

#### Scenario: Object-source outcome matrix remains stable

- **WHEN** the direct characterization exercises a literal object with two
  ordered skipped values, surviving static values, and a captured transform,
  an object-valued static identifier, missing and scalar identifiers, and a
  non-object expression
- **THEN** `object_source_routing_preserves_values_captures_and_errors` SHALL
  pass with exact values, skips, capture source, and errors
- **AND** the G1 public-boundary diff check from `design.md` SHALL return empty

#### Scenario: Routing remains flat and engine-local

- **WHEN** V1 object-source routing is flattened
- **THEN** G2 SHALL find two named structural guards, one expression match,
  and no old nested route inside the target helper
- **AND** the G4 V2 facts hash SHALL remain exact
- **AND** mapped V1 Clippy, Rust-unit, NAPI-canary, and integration commands
  SHALL exit zero
