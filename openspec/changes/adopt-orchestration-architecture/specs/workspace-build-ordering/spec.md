## ADDED Requirements

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
