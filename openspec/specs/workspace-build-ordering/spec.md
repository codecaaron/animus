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
