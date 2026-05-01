## ADDED Requirements

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
