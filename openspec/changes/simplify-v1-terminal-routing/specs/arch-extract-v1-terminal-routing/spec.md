## ADDED Requirements

### Requirement: Exhaustive private terminal routing

The V1 chain walker SHALL route each terminal kind through one private,
exhaustive match while preserving the existing terminal descriptor boundary.

#### Scenario: Terminal routing has no panic-shaped impossible arm

- **WHEN** the V1 terminal argument router is simplified
- **THEN** `rg -n '^fn extract_terminal_arg\(' packages/extract/src/chain_walker.rs` SHALL return exactly one definition
- **AND** `rg -n 'unreachable!\(\)' packages/extract/src/chain_walker.rs` SHALL return no matches
- **AND** the G1 boundary diff check from `design.md` SHALL return empty output

#### Scenario: Public terminal shapes remain stable

- **WHEN** V1 parses valid `.asElement()`, `.asComponent()`, and `.asClass()` chains
- **THEN** the focused `terminal_argument_shapes_preserve_tags` Rust unit SHALL pass
- **AND** the mapped V1 Clippy, Rust-unit, NAPI-canary, and integration commands SHALL exit zero
