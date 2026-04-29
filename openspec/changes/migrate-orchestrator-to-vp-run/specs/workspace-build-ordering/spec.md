## ADDED Requirements

### Requirement: Cross-Workspace Dispatch via vp Task Graph

Cross-workspace task dispatch (running a script across multiple workspace packages in dependency-derived order) SHALL be performed via the Vite+ task graph (`vp run` against tasks declared in `vp.config.ts`). The canonical dispatch surface for `build:ts`, `build:all`, and any other tier that fans out across multiple packages SHALL be `vp run <task>`. The `bun run --filter` invocation pattern SHALL continue to work for ad-hoc per-package dispatch by developers, but the canonical multi-package dispatch surface owned by this spec is now vp's task graph.

The dependency-derived ordering invariant defined elsewhere in this spec is preserved verbatim — adding a new package to the workspace with appropriate `package.json` `dependencies` SHALL position it correctly in the build graph without requiring edits to `vp.config.ts` task definitions, provided vp's task graph derives ordering from workspace dependencies. If vp does NOT derive ordering automatically, `vp.config.ts` SHALL declare task dependencies explicitly to mirror the dependency-derived ordering invariant.

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

#### Scenario: Adding a new package does not require vp.config.ts edits

- **WHEN** a maintainer adds a new package to the workspace with appropriate `dependencies` in its `package.json`
- **AND** the package declares a `build:ts` script
- **AND** a developer runs `vp run build:ts`
- **THEN** the new package builds in its correct topological position
- **AND** no edit to `vp.config.ts` was required (vp's task graph derives the new package automatically OR the task definition is workspace-glob-shaped to include the new package)

#### Scenario: bun run --filter remains available for ad-hoc per-package dispatch

- **WHEN** a developer runs `bun run --filter '@animus-ui/system' build:ts`
- **THEN** only the `packages/system` `build:ts` script executes
- **AND** the invocation continues to work as before (Bun's workspace-resolution semantics unchanged)
- **AND** this ad-hoc surface is for individual-package work, not cross-workspace orchestration
