## ADDED Requirements

### Requirement: Private engine-local phase seam

The V1 project analyzer SHALL keep a newly extracted orchestration phase private and engine-local while preserving its public boundary and phase timing ownership.

#### Scenario: Static-resolution phase is a private in-file seam

- **WHEN** Phase 2 static-value enrichment is extracted from `analyze()`
- **THEN** `rg -n '^fn resolve_project_static_values\(' packages/extract/src/project_analyzer.rs` SHALL return exactly one definition
- **AND** `rg -n '^pub.*resolve_project_static_values' packages/extract/src/project_analyzer.rs` SHALL return no matches
- **AND** `test ! -e packages/extract/src/static_resolution.rs` SHALL exit zero

#### Scenario: Public and timing boundaries remain unchanged

- **WHEN** the static-resolution phase seam is introduced
- **THEN** the G1 and G2 scoped diff checks from `design.md` SHALL return empty output
- **AND** the mapped V1 Clippy, Rust-unit, NAPI-canary, and integration commands SHALL exit zero
