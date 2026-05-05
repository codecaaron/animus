# workspace-build-ordering Specification

## Purpose

Ensure the monorepo build system derives package build order from dependency declarations rather than hand-maintained script chains, supporting both TS-only and full builds with consistent package script naming.

## Requirements

### Requirement: Dependency-derived build ordering

The monorepo build system SHALL derive package build order from `package.json` dependency declarations, not from hand-maintained script chains. Adding a new package SHALL NOT require editing root build scripts.

#### Scenario: New package added

- **WHEN** a new package is added to the workspace with appropriate `dependencies` in its `package.json`
- **THEN** running `bun run build:ts` SHALL build it in the correct topological position without any root script changes

#### Scenario: Topological ordering respected

- **WHEN** package A depends on package B
- **THEN** `bun run build:ts` SHALL build B before A

### Requirement: Two-tier build strategy

The build system SHALL support two build tiers: a fast TS-only build (`build:ts`) and a full build including Rust NAPI compilation (`build:all`).

#### Scenario: TS-only build

- **WHEN** `bun run build:ts` is executed
- **THEN** all TS library packages SHALL build their TypeScript output only (no Rust compilation)

#### Scenario: Full build

- **WHEN** `bun run build:all` is executed
- **THEN** the Rust NAPI crate SHALL build first, followed by all TS library packages

### Requirement: Consistent package script naming

Every buildable library package SHALL have a `build:ts` script for TS-only builds. Packages that are TS-only SHALL alias `build` to `build:ts`.

#### Scenario: TS-only package scripts

- **WHEN** a TS-only package (e.g., system, vite-plugin) is inspected
- **THEN** it SHALL have both `build:ts` and `build` scripts, where `build` executes `build:ts`

#### Scenario: Mixed-language package scripts

- **WHEN** extract (Rust + TS) is inspected
- **THEN** `build:ts` SHALL build only the TS pipeline, and `build` SHALL build both Rust and TS

### Requirement: Binding to orchestration-architecture

The dependency-derived build ordering, two-tier build strategy (`build:ts` vs `build:all`), and consistent per-package script naming defined in this spec are realized through the orchestrator binding designated by the `orchestration-architecture` capability. The current binding uses `bun run --filter './packages/*'` for topological dispatch. A future rebind to a different orchestrator (e.g., Vite+ via the `migrate-orchestrator-to-vp-run` follow-on policy change) SHALL preserve the dependency-derived-ordering invariant — adding a new package with appropriate `package.json` dependencies SHALL NOT require editing root orchestrator scripts or task definitions to position it correctly in the build graph.

The two-tier strategy (a fast TS-only tier and a full Rust+TS tier) SHALL be preserved under any orchestrator binding. The Rust NAPI step in the full tier SHALL continue to invoke `cargo` / `napi build` per the Rust-pipeline exclusion in `orchestration-architecture`.

#### Scenario: Dependency-derived ordering survives orchestrator rebind

- **WHEN** a cutover follow-on rebinds the orchestrator
- **AND** a new package is added with appropriate `dependencies` in its `package.json`
- **AND** the orchestrator's full-build task is invoked
- **THEN** the package builds in its correct topological position
- **AND** no root orchestrator script or task config required edits

#### Scenario: Two-tier strategy survives orchestrator rebind

- **WHEN** a cutover follow-on rebinds the orchestrator
- **THEN** a fast TS-only build tier exists that builds all TS library packages without invoking the Rust NAPI build
- **AND** a full build tier exists that invokes the Rust NAPI build first, then the TS library build
