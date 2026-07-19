## ADDED Requirements

### Requirement: Flat V1 variant argument routing

The V1 style evaluator SHALL route variant config fields through one flat,
engine-local typed decision and collect variant options through one private
helper while preserving evaluator results and diagnostics.

#### Scenario: Variant config matrix remains stable

- **WHEN** explicit/default fields, base and option skips, ignored config
  entries, ordered and repeated options, wrong-typed known fields, and bailing
  base/option style-object spreads are parsed
- **THEN** `variant_arg_preserves_config_and_skip_order` and
  `variant_arg_preserves_structural_bails` SHALL pass
- **AND** the G1 public-boundary diff check from `design.md` SHALL return empty

#### Scenario: Routing remains flat and engine-local

- **WHEN** V1 variant argument routing is separated from option collection
- **THEN** G2 SHALL find one private helper, one production call, one typed
  top-level match, and no old nested variants branch
- **AND** the G4 V2 evaluator hash SHALL remain exact
- **AND** mapped V1 Clippy, Rust-unit, NAPI-canary, and integration commands
  SHALL exit zero
