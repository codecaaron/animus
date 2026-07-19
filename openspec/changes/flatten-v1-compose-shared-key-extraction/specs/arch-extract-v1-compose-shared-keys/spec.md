## ADDED Requirements

### Requirement: Flat V1 compose shared-key extraction

The V1 JSX scanner SHALL extract compose shared keys through one flat,
engine-local decision while preserving emitted family-record behavior.

#### Scenario: Asymmetric shared-key matrix remains stable

- **WHEN** compose options contain outer and inner spreads, wrong-typed and
  duplicate `shared` properties, `[outerDynamic]` and `[innerDynamic]`
  unresolvable expression keys, and ordered identifier plus computed string and
  numeric literal shared keys
- **THEN** `compose_shared_keys_preserve_abort_skip_and_order` SHALL pass
- **AND** it SHALL assert the exact family count and each family index's exact
  shared-key vector
- **AND** the G1 public-boundary diff check from `design.md` SHALL return empty

#### Scenario: Extraction remains flat and engine-local

- **WHEN** V1 shared-key property routing is flattened
- **THEN** G2 SHALL find two flat outer guards, one inner filter, and no old
  nested branch
- **AND** the G4 V2 JSX scanner hash SHALL remain exact
- **AND** mapped V1 Clippy, Rust-unit, NAPI-canary, and integration commands
  SHALL exit zero
