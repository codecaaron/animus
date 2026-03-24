## ADDED Requirements

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
