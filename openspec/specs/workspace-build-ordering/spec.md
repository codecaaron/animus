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

### Requirement: Cross-Workspace Dispatch via vp Task Graph

Cross-workspace task dispatch (running a script across multiple workspace packages in dependency-derived order) SHALL be performed via the Vite+ task graph (`vp run` against tasks declared in `vite.config.ts`). The canonical dispatch surface for `build:ts`, `build:all`, and any other tier that fans out across multiple packages SHALL be `vp run <task>`. The `bun run --filter` invocation pattern SHALL continue to work for ad-hoc per-package dispatch by developers, but the canonical multi-package dispatch surface owned by this spec is now vp's task graph.

The dependency-derived ordering invariant defined elsewhere in this spec is preserved verbatim — adding a new package to the workspace with appropriate `package.json` `dependencies` SHALL position it correctly in the build graph without requiring edits to `vite.config.ts` task definitions, provided vp's task graph derives ordering from workspace dependencies. If vp does NOT derive ordering automatically, `vite.config.ts` SHALL declare task dependencies explicitly to mirror the dependency-derived ordering invariant.

The two-tier build strategy (fast TS-only `build:ts` / full Rust+TS `build:all`) is preserved verbatim. The Rust NAPI step in `build:all` SHALL continue to invoke `cargo` / `napi build` per the Rust-pipeline exclusion — vp dispatches the cargo-based command but does NOT replace the cargo toolchain.

#### Scenario: vp run build:ts dispatches across workspace packages in dependency order

- **WHEN** a developer runs `vp run build:ts` at the repository root
- **THEN** vp's task graph dispatches the `build:ts` task across every workspace package that declares one
- **AND** packages build in dependency-derived order (B before A when A depends on B)
- **AND** packages without a `build:ts` script are skipped without error

#### Scenario: vp run build:all triggers Rust NAPI build first

- **WHEN** a developer runs `vp run build:all` at the repository root
- **THEN** the Rust NAPI build step (`cargo` / `napi build --platform --release`) runs first
- **AND** TypeScript library packages build after, in dependency-derived order
- **AND** vp does NOT attempt to compile Rust source itself

#### Scenario: Adding a new package does not require vite.config.ts edits

- **WHEN** a maintainer adds a new package to the workspace with appropriate `dependencies` in its `package.json`
- **AND** the package declares a `build:ts` script
- **AND** a developer runs `vp run build:ts`
- **THEN** the new package builds in its correct topological position
- **AND** no edit to `vite.config.ts` was required (vp's task graph derives the new package automatically OR the task definition is workspace-glob-shaped to include the new package)

#### Scenario: bun run --filter remains available for ad-hoc per-package dispatch

- **WHEN** a developer runs `bun run --filter '@animus-ui/system' build:ts`
- **THEN** only the `packages/system` `build:ts` script executes
- **AND** the invocation continues to work as before (Bun's workspace-resolution semantics unchanged)
- **AND** this ad-hoc surface is for individual-package work, not cross-workspace orchestration
