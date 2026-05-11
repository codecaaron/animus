## ADDED Requirements

### Requirement: CI builds Rust crate on all supported platforms
The CI pipeline SHALL build the Rust extraction crate on each supported NAPI target using native GitHub Actions runners. Each platform build SHALL produce a `.node` binary artifact.

#### Scenario: Matrix build across platforms
- **WHEN** a push to main or a pull request triggers CI
- **THEN** the pipeline SHALL run parallel Rust builds on `macos-14` (aarch64-apple-darwin), `ubuntu-latest` (x86_64-unknown-linux-gnu), and `ubuntu-24.04-arm` (aarch64-unknown-linux-gnu)

#### Scenario: Each build produces a binary artifact
- **WHEN** a platform build completes successfully
- **THEN** the job SHALL upload the `.node` binary as a GitHub Actions artifact named by platform (e.g., `animus-extract.linux-x64-gnu.node`)

#### Scenario: Builds use locked dependencies
- **WHEN** the Rust crate builds in CI
- **THEN** the build SHALL use `--locked` to ensure the committed `Cargo.lock` is respected

#### Scenario: Cargo dependencies are cached
- **WHEN** the Rust build runs in CI
- **THEN** Cargo registry and target directories SHALL be cached between runs to reduce build time

### Requirement: Full pipeline verification on linux
The CI pipeline SHALL run `bun run verify:full` on linux after the Rust crate is built, proving that extraction, showcase build, and all tests pass on a non-development platform.

#### Scenario: Verify job uses linux binary
- **WHEN** the linux-x64 Rust build completes
- **THEN** a verify job SHALL download the linux `.node` binary, install dependencies, and run `bun run verify:full`

#### Scenario: Verify job proves end-to-end extraction
- **WHEN** `bun run verify:full` runs in CI
- **THEN** it SHALL build all TS packages, run tests (including type tests), run biome checks, and build the showcase — all using the CI-built extraction binary

### Requirement: ARM linux build is optional
The `aarch64-unknown-linux-gnu` build SHALL be configured with `continue-on-error: true` so that ARM runner unavailability does not block PRs.

#### Scenario: ARM build failure does not block CI
- **WHEN** the ARM linux build fails due to runner unavailability
- **THEN** the overall CI pipeline SHALL still pass (the ARM job is advisory, not required)

### Requirement: Platform package scaffolding for npm publishing
The CI pipeline SHALL include a release job (triggered manually or on tag) that uses `napi pre-publish -t npm` to generate scoped platform packages and publish them.

#### Scenario: Release generates scoped packages
- **WHEN** a release is triggered
- **THEN** the pipeline SHALL download all platform `.node` artifacts and run `napi pre-publish -t npm` to create `@animus-ui/extract-darwin-arm64`, `@animus-ui/extract-linux-x64-gnu`, and `@animus-ui/extract-linux-arm64-gnu` packages

#### Scenario: Platform packages are optionalDependencies
- **WHEN** the root `@animus-ui/extract` package is published
- **THEN** its `optionalDependencies` SHALL list all scoped platform packages so that npm/bun installs only the binary for the current platform

#### Scenario: Release job requires all platform builds
- **WHEN** a release is triggered
- **THEN** the release job SHALL depend on successful completion of ALL platform builds (not just linux-x64)
