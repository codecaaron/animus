## MODIFIED Requirements

### Requirement: Verify script runs all test suites
The `verify` script SHALL run both JavaScript tests (`bun test`) AND Rust unit tests (`cargo test --lib`) to gate changes. Rust tests SHALL also be included in `verify:full`.

#### Scenario: verify includes Rust tests
- **WHEN** a developer runs `bun run verify`
- **THEN** Rust library tests SHALL execute via `cargo test --lib` in `packages/extract/`
- **AND** failure in Rust tests SHALL cause `verify` to exit non-zero

#### Scenario: verify:full includes Rust tests
- **WHEN** a developer runs `bun run verify:full`
- **THEN** Rust library tests SHALL execute alongside JS tests, showcase build, and biome check
