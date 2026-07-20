# arch-extract-v2-spine Specification

## Purpose
TBD - created by archiving change extract-v2-spine. Update Purpose after archive.
## Requirements
### Requirement: Single-parse analysis budget

The v2 engine SHALL parse each source file at most once per build, measured by the parity harness parse counter.

#### Scenario: Parse counter enforces the budget

- WHEN `vp run verify:parity -- --parse-count` executes over the fixture corpus
- THEN every fixture reports a v2 parse count less than or equal to that fixture's source file count, and any excess fails the run

### Requirement: Fact-only manifest
The v2 engine's manifest-producing modules SHALL NOT embed generated JavaScript or CSS code strings in manifest data structures.

#### Scenario: No code formatting into manifest modules
- WHEN `rg -n 'format!\(' packages/extract/crates/extract-v2/src/ --glob '*manifest*'` runs
- THEN it returns no matches, while the positive control `rg -c 'format!' packages/extract/src/transform_emitter.rs` returns a non-zero count proving the pattern detects the banned practice

### Requirement: No raw string surgery
The v2 engine SHALL NOT use `replace_range` or slice-to-length string surgery anywhere in its source tree.

#### Scenario: Surgery pattern absent with live control
- WHEN `rg -n 'replace_range|\[\.\..*len\(\)' packages/extract/crates/extract-v2/src/` runs
- THEN it returns no matches, while the same pattern over `packages/extract/src/` returns at least four matches (the v1 sites that motivated the ban) — a silent control invalidates the gate

### Requirement: V1 isolation

Historical note: this gate held from the v2 spine's creation until v1's retirement (`retire-extract-v1`), guaranteeing the rewrite never depended on the crate it replaced. Post-retirement the obligation is non-resurrection: the v2 engine crate SHALL NOT depend on, vendor, or reintroduce v1 crate code as a dependency.

#### Scenario: No path dependency or v1 module use

- WHEN `rg -n 'path *=|animus_extract' packages/extract/crates/extract-v2/Cargo.toml packages/extract/crates/extract-v2/src/` runs
- THEN it returns no matches (no dependency edge to any v1 crate, past or resurrected)

### Requirement: Umbrella dependency surface
The v2 engine SHALL consume oxc exclusively through the umbrella `oxc` crate; individual `oxc_*` crates are prohibited outside a recorded allowlist (currently empty).

#### Scenario: Single oxc dependency line
- WHEN `grep -E '^oxc' packages/extract/crates/extract-v2/Cargo.toml` runs
- THEN every returned line begins `oxc =` (umbrella), while the positive control `grep -cE '^oxc_' packages/extract/Cargo.toml` returns 9 (v1's individual pins prove the pattern detects them)

### Requirement: Construction and ownership containment
Self-referential AST ownership (`self_cell!`) SHALL be confined to a single ownership module, and AST node construction (`AstBuilder` use) SHALL be confined to a single factory module within the v2 source tree.

#### Scenario: Containment counts
- WHEN `rg -l 'self_cell!' packages/extract/crates/extract-v2/src/` and `rg -l 'AstBuilder' packages/extract/crates/extract-v2/src/` run
- THEN each returns at most one file

