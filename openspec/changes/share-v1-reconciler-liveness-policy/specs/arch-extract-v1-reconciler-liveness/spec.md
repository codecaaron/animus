## ADDED Requirements

### Requirement: Shared private component-liveness policy

The V1 reconciler SHALL use one private, engine-local policy to decide whether
a component is eligible for both actual production elimination and dev-mode
prospective-elimination diagnostics.

#### Scenario: Actual and prospective paths select the same components

- **WHEN** the same component list, usage ledger, and provenance-parent set are
  evaluated by actual reconciliation and prospective diagnostics
- **THEN** `actual_and_prospective_component_liveness_match` SHALL pass for
  unrendered non-parent, rendered, and unrendered parent components
- **AND** the G1 public-boundary diff check from `design.md` SHALL return empty

#### Scenario: Liveness policy remains private and engine-local

- **WHEN** the V1 liveness policy is centralized
- **THEN** the G2 checks SHALL find one private definition and exactly two
  production calls with no duplicated raw condition
- **AND** the G4 V2 hash SHALL remain exact
- **AND** mapped V1 Clippy, Rust-unit, NAPI-canary, and integration commands
  SHALL exit zero
