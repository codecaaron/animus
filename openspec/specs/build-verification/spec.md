## Purpose

Requirements for the `build-verification` capability: Tiered clean scripts; Rebuild script for guaranteed fresh state; Showcase as verification gate; and 4 more.

## Requirements

### Requirement: Tiered clean scripts

The root `package.json` SHALL provide three clean script tiers: `clean:light` for high-risk caches only, `clean:full` for all build artifacts and caches, and `clean` (unchanged) for backward compatibility.

#### Scenario: clean:light removes Vite cache and TS dist

- **WHEN** `bun run clean:light` is executed
- **THEN** the following SHALL be removed: `node_modules/.vite/`, `packages/*/dist/`
- **AND** the following SHALL NOT be removed: `packages/extract/target/`, `packages/extract/*.node`

#### Scenario: clean:full removes all build artifacts and caches

- **WHEN** `bun run clean:full` is executed
- **THEN** the following SHALL be removed: `node_modules/.vite/`, `packages/*/dist/`, `packages/extract/target/`, `packages/extract/*.node`

#### Scenario: clean unchanged for backward compatibility

- **WHEN** `bun run clean` is executed
- **THEN** it SHALL behave identically to its current behavior: removing `packages/*/dist` and `packages/extract/target`

### Requirement: Rebuild script for guaranteed fresh state

The root `package.json` SHALL provide a `rebuild` script that performs a full clean followed by a complete build in dependency order.

#### Scenario: rebuild produces fresh state from any cache corruption

- **WHEN** `bun run rebuild` is executed
- **THEN** it SHALL first execute `clean:full` to remove all caches and artifacts
- **AND** then execute `build:all` to rebuild Rust crate followed by all TS packages in dependency order

#### Scenario: rebuild succeeds after NAPI signature change

- **WHEN** a Rust NAPI function signature has changed and the old `.node` binary exists
- **AND** `bun run rebuild` is executed
- **THEN** the old `.node` binary SHALL be removed before cargo build
- **AND** the new binary SHALL be produced with the updated signature

### Requirement: Showcase as verification gate

The `verify:full` script SHALL include the showcase build as the extraction pipeline integration gate. A separate `verify:showcase` script SHALL exist for focused extraction verification.

#### Scenario: verify:full includes showcase build

- **WHEN** `bun run verify:full` is executed
- **THEN** it SHALL execute: Rust build, TS build (ordered), tests, biome check, AND showcase build
- **AND** if the showcase build fails, `verify:full` SHALL fail

#### Scenario: verify:showcase tests extraction end-to-end

- **WHEN** `bun run verify:showcase` is executed
- **THEN** it SHALL execute: `build:all` followed by showcase build (`bun run --filter './packages/showcase' build`)

#### Scenario: verify (without :full) remains fast

- **WHEN** `bun run verify` is executed
- **THEN** it SHALL NOT include the showcase build or Rust build (unchanged behavior)

### Requirement: Build dependency order

All build scripts that compile multiple packages SHALL respect the dependency order: extract (Rust) → core → theming → runtime → system → vite-plugin → ui. The showcase build SHALL only execute after all dependencies are built.

#### Scenario: build:ts respects dependency order

- **WHEN** `bun run build:ts` is executed
- **THEN** packages SHALL build in order: core, theming, runtime, system, vite-plugin, ui
- **AND** each package build SHALL complete before the next begins

#### Scenario: build:all includes Rust before TS

- **WHEN** `bun run build:all` is executed
- **THEN** the Rust crate SHALL build first (`build:extract`)
- **AND** then TS packages SHALL build in dependency order (`build:ts`)

### Requirement: Verify script runs all test suites

The `verify` script SHALL run both JavaScript tests (`bun test`) AND Rust unit tests (`cargo test --lib`) to gate changes. Rust tests SHALL also be included in `verify:full`.

#### Scenario: verify includes Rust tests

- **WHEN** a developer runs `bun run verify`
- **THEN** Rust library tests SHALL execute via `cargo test --lib` in `packages/extract/`
- **AND** failure in Rust tests SHALL cause `verify` to exit non-zero

#### Scenario: verify:full includes Rust tests

- **WHEN** a developer runs `bun run verify:full`
- **THEN** Rust library tests SHALL execute alongside JS tests, showcase build, and biome check

### Requirement: Verification commands use derived build ordering

All verification commands SHALL use the `--filter`-based build scripts internally. The verification command surface (`verify`, `verify:full`, `verify:showcase`) SHALL remain unchanged.

#### Scenario: verify command

- **WHEN** `bun run verify` is executed
- **THEN** it SHALL run `build:ts` (via --filter), compile, test, test:rust, test:types, and check — same outputs as before

#### Scenario: verify:full command

- **WHEN** `bun run verify:full` is executed
- **THEN** it SHALL run `build:all` (Rust + --filter TS), test, check, and showcase build — same outputs as before

### Requirement: Rust unit tests run independently from NAPI binary build in CI

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
