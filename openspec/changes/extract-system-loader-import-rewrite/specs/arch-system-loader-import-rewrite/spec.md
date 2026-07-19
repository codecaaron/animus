## ADDED Requirements

### Requirement: Isolated byte-stable import rewriting

The system-loader SHALL keep import-specifier rendering behind one private
helper while preserving exact existing rewrite outputs and surrounding module
boundaries.

#### Scenario: Import rendering has one private owner

- **WHEN** the import renderer extraction is complete
- **THEN** the three G2 commands in `design.md` SHALL report `1`, `2`, and `0`
- **AND** the G1 public-boundary command SHALL return empty output

#### Scenario: Existing import forms remain exact

- **WHEN** bare, explicit-empty, named, aliased, default-plus-named,
  namespace, default-plus-namespace, resolved-key, and stub-key imports are
  rewritten
- **THEN** `RUSTUP_TOOLCHAIN=1.97.0 repowise distill cargo test --manifest-path packages/extract/crates/system-loader/Cargo.toml tests::import_rewrite_preserves_existing_output_matrix --lib` SHALL pass one exact-output test

#### Scenario: Surrounding shared-loader boundaries remain stable

- **WHEN** the bounded import extraction is reviewed
- **THEN** the G4 changed-line search SHALL return empty output
- **AND** the G5 protected foreign-diff hash SHALL remain exact
- **AND** every G6 mapped verification command SHALL exit zero
