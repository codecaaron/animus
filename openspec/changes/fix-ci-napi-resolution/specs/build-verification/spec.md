## MODIFIED Requirements

### Requirement: Rust unit tests run in build-extract job
The `build-extract` CI job SHALL run `cargo test --lib` before building the NAPI binary. The `verify` job SHALL NOT include Rust toolchain setup, Rust cache, or `cargo test --lib`.

#### Scenario: Rust tests pass in build-extract
- **WHEN** `build-extract` runs on each platform matrix entry
- **THEN** `cargo test --lib` executes before `napi build` and the job proceeds to binary upload on success

#### Scenario: Rust tests fail in build-extract
- **WHEN** `cargo test --lib` fails in `build-extract`
- **THEN** the NAPI binary build is skipped and no artifact is uploaded, blocking the `verify` job

#### Scenario: Verify job has no Rust dependencies
- **WHEN** the `verify` job runs
- **THEN** it does not install Rust toolchain, does not restore Rust cache, and does not run `cargo test --lib`
