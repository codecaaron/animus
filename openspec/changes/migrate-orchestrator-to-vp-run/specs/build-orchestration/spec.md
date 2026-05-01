## ADDED Requirements

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
