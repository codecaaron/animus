## MODIFIED Requirements

### Requirement: Rust unit tests run independently from NAPI binary build
A dedicated `test-rust` CI job SHALL run `cargo test --lib` in debug profile. The `build-extract` job builds NAPI binaries without running tests. The `verify` job depends on both (`needs: [build-extract, test-rust]`) and SHALL NOT include Rust toolchain setup, Rust cache, or `cargo test --lib`.

#### Scenario: Rust tests pass in dedicated job
- **WHEN** CI runs the `test-rust` job
- **THEN** `cargo test --lib` executes with its own Rust toolchain and cache, independent of the NAPI binary build matrix

#### Scenario: Rust tests fail
- **WHEN** `cargo test --lib` fails in `test-rust`
- **THEN** the `verify` job is blocked (via `needs` dependency), preventing the pipeline from proceeding

#### Scenario: build-extract is test-free
- **WHEN** `build-extract` runs on each platform matrix entry
- **THEN** it builds and uploads the NAPI binary without running `cargo test --lib`

#### Scenario: Verify job has no Rust dependencies
- **WHEN** the `verify` job runs
- **THEN** it does not install Rust toolchain, does not restore Rust cache, and does not run `cargo test --lib`
