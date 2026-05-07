# build-orchestration Specification

## Purpose

Defines the build dependency graph for the monorepo — tier topology, NAPI binary build, TypeScript package build order, and the orchestrator binding that materializes them. Update Purpose after archive cycles.

## Requirements

### Requirement: Full build DAG in root scripts

The root `package.json` SHALL contain scripts that encode the complete build dependency graph. A developer SHALL be able to build the entire project from a clean state with a single command.

#### Scenario: Build all from clean state

- **WHEN** a developer runs `bun run build:all` from the repository root
- **THEN** the Rust extraction crate is built first (napi build)
- **THEN** TypeScript packages are built in dependency order: core → theming → runtime → vite-plugin → ui
- **THEN** all `dist/` directories contain current build artifacts

#### Scenario: Build only the Rust crate

- **WHEN** a developer runs `bun run build:extract` from the repository root
- **THEN** only `packages/extract` is built via `napi build --platform --release`
- **THEN** the `.node` binary is updated in `packages/extract/`

#### Scenario: Build only TypeScript packages

- **WHEN** a developer runs `bun run build:ts` from the repository root
- **THEN** TypeScript packages are built in dependency order: core → theming → runtime → vite-plugin → ui
- **THEN** the Rust crate is NOT rebuilt

### Requirement: Clean command

The root `package.json` SHALL contain a `clean` script that removes all build artifacts, returning the repo to a pre-build state.

#### Scenario: Clean all artifacts

- **WHEN** a developer runs `bun run clean` from the repository root
- **THEN** all `packages/*/dist/` directories are removed
- **THEN** `packages/extract/target/` (Rust build cache) is removed
- **THEN** no source files or configuration files are affected

### Requirement: Full verification pipeline

The root `package.json` SHALL contain a `verify` script that validates the entire project: build, test, typecheck, and lint.

#### Scenario: Full verification from clean state

- **WHEN** a developer runs `bun run verify` from the repository root
- **THEN** all packages are built in correct order (build:all)
- **THEN** all tests pass (bun test)
- **THEN** type checking passes (tsc --noEmit)
- **THEN** linting passes (biome check)

#### Scenario: Verification catches stale artifacts

- **WHEN** a developer modifies Rust source in `packages/extract/src/`
- **THEN** running `bun run verify` rebuilds the Rust crate before running tests
- **THEN** tests run against the updated `.node` binary

### Requirement: Granular test commands

The root `package.json` SHALL contain scoped test scripts for common verification workflows.

#### Scenario: Run only the canary extraction test

- **WHEN** a developer runs `bun run test:canary` from the repository root
- **THEN** only `packages/extract/tests/canary.test.ts` executes
- **THEN** other test files are not discovered or run

#### Scenario: Showcase app as integration smoke test

- **WHEN** a developer runs `bun run test:showcase` from the repository root
- **THEN** the showcase app's Vite build runs (`vite build`)
- **THEN** a successful build confirms the full extraction pipeline is operational

### Requirement: Missing tsdown configs

Every TypeScript package with `tsdown` in its build script SHALL have a `tsdown.config.ts` that extends the shared base config.

#### Scenario: vite-plugin has tsdown config

- **WHEN** examining `packages/vite-plugin/tsdown.config.ts`
- **THEN** it imports `createConfig` from the shared base
- **THEN** it overrides `platform: 'node'` (vite plugins run in Node)

#### Scenario: runtime has tsdown config

- **WHEN** examining `packages/runtime/tsdown.config.ts`
- **THEN** it imports `createConfig` from the shared base
- **THEN** it uses the default configuration (no overrides needed)

### Requirement: TypeScript build pipeline

The monorepo SHALL build all TypeScript library packages via `bun run --filter` with topological ordering derived from workspace dependency graph.

#### Scenario: build:ts executes all TS packages

- **WHEN** `bun run build:ts` is executed at the root
- **THEN** all packages with a `build:ts` script SHALL execute in dependency order

#### Scenario: Packages without build:ts are skipped

- **WHEN** a package (e.g., `_integration`, `_docs`) has no `build:ts` script
- **THEN** `bun run --filter` SHALL skip it without error

#### Scenario: App packages excluded from library build

- **WHEN** `bun run build:ts` is executed
- **THEN** showcase and next-test-app SHALL NOT be built (they are app builds, not library builds)

### Requirement: Binding to orchestration-architecture

The build DAG, clean command, verification pipeline, and granular test commands defined in this spec are realized through the orchestrator binding designated by the `orchestration-architecture` capability. The current binding uses `bun run` (specifically `bun run build:all`, `bun run build:extract`, `bun run build:ts`, `bun run clean`, `bun run verify`). A future rebind to a different orchestrator (e.g., Vite+ via the `migrate-orchestrator-to-vp-run` follow-on policy change) SHALL preserve every behavioral requirement in this spec — DAG ordering, clean coverage, verification composition — while updating only the invocation surface.

The Rust NAPI build (`packages/extract`) SHALL remain owned by `cargo` + `@napi-rs/cli` per the Rust-pipeline exclusion in `orchestration-architecture`. Any orchestrator binding that orchestrates the full DAG MUST shell out to the cargo-based NAPI build for the Rust step.

#### Scenario: Build DAG semantics survive orchestrator rebind

- **WHEN** a cutover follow-on rebinds the orchestrator
- **THEN** the full-build task continues to build packages in the correct topological position
- **AND** the Rust NAPI build continues to invoke `cargo` / `napi build`
- **AND** the clean task continues to remove `dist/`, `target/`, and `.node` artifacts as documented
- **AND** the verification pipeline continues to compose its constituent tiers in the correct order

### Requirement: Build Pipeline Invocation via vp run

The full build DAG, full verification pipeline, and granular build commands defined in this spec are dispatched through Vite+ (`vp run`). The canonical invocation surface for `build:all`, `build:extract`, `build:ts`, and `verify` SHALL be `vp run <task>`. Migrated task names live ONLY in `vite.config.ts` `run.tasks` (not in `package.json` `scripts`) — `bun run <migrated-name>` returns "script not found" by design.

The `clean` command in this slice remains a direct shell script and STAYS in `package.json` `scripts` as `bun run clean*` invocations — cleaning is destructive, must always execute, and is reserved for a future `resolve-clean-surface` follow-on for any vp-side dispatch.

The Rust NAPI build SHALL continue to be invoked through `cargo` / `napi build --platform --release` per the Rust-pipeline exclusion. vp dispatches the build but does NOT replace the cargo toolchain. The `clean` command in this slice SHALL remain a direct shell invocation (`rm -rf` against `packages/*/dist/`, `packages/extract/target/`, and `*.node` artifacts) — `vp cache` (or whatever vp provides for cleaning) is NOT bound by this slice and is reserved for a separate follow-on.

The DAG semantics, clean coverage, and verification composition defined elsewhere in this spec are preserved verbatim — only the dispatch surface changes.

#### Scenario: vp run build:all builds Rust before TypeScript

- **WHEN** a developer runs `vp run build:all` from the repository root
- **THEN** the Rust extraction crate builds first (`cargo` / `napi build`)
- **AND** TypeScript packages build after in dependency order
- **AND** all `dist/` directories contain current build artifacts

#### Scenario: vp run build:extract builds only the Rust crate

- **WHEN** a developer runs `vp run build:extract` from the repository root
- **THEN** vp's `build:extract` task body invokes `napi build --platform --release` (or equivalent) for `packages/extract`
- **AND** the `.node` binary in `packages/extract/` is updated
- **AND** no TypeScript package is built

#### Scenario: vp run build:ts builds only TypeScript packages

- **WHEN** a developer runs `vp run build:ts` from the repository root
- **THEN** TypeScript library packages build in dependency order
- **AND** the Rust crate is NOT rebuilt

#### Scenario: vp run clean removes build artifacts via shell

- **WHEN** a developer runs `vp run clean` from the repository root
- **THEN** vp dispatches the existing `rm -rf` clean shell logic
- **AND** all `packages/*/dist/`, `packages/extract/target/`, and `*.node` artifacts are removed
- **AND** no source files or configuration files are affected

#### Scenario: vp run verify runs the full verification pipeline

- **WHEN** a developer runs `vp run verify` from the repository root
- **THEN** the fast-gate atomic tiers execute in dependency order
- **AND** execution stops at the first failing tier with the failing tier's name visible in output
