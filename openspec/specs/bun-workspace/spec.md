## Purpose

Defines Bun as the monorepo's sole package manager and workspace runner, and constrains the shape of root-level `package.json` scripts so that workflows (build, test, verification, lint, release) use one authoritative surface. Downstream capabilities (e.g., `verification-tier-policy`) extend the script inventory via MODIFIED deltas against the Requirements below.
## Requirements
### Requirement: Bun as package manager
The monorepo SHALL use Bun as the sole package manager. `bun install` SHALL resolve all workspace dependencies and produce a `bun.lockb` lockfile. No other package manager lockfiles (yarn.lock, package-lock.json) SHALL exist in the repository.

#### Scenario: Clean install
- **WHEN** a developer runs `bun install` from the repository root
- **THEN** all workspace packages and their dependencies are installed, and `bun.lockb` is created

#### Scenario: Workspace dependency resolution
- **WHEN** `@animus-ui/theming` declares a dependency on `@animus-ui/core`
- **THEN** Bun resolves it to the local workspace package (not a registry version)

### Requirement: Bun workspace script execution
The monorepo SHALL use Bun's native workspace features for running scripts across packages. No dedicated orchestration tool (NX, Lerna, Turborepo) SHALL be required.

#### Scenario: Run build across all packages
- **WHEN** a developer runs `bun run build` from the root
- **THEN** all active workspace packages are built in dependency order (core → theming → ui)

#### Scenario: Run script in specific package
- **WHEN** a developer runs `bun run --filter @animus-ui/core build`
- **THEN** only the core package build script executes

### Requirement: Simplified root scripts
The root `package.json` SHALL contain scripts organized by verb:scope naming convention. The script set SHALL cover: build (granular + all), test, type-check, lint, format, clean, and verification via the tier policy. Script commands SHALL use `bun` (not yarn, npx, or nx). Verification is handled by the `verification-tier-policy` capability (atomic tiers + composite orchestrators named `verify:<tier>[:<scope>]`); the root script set MUST include both the atomic tiers and the composite orchestrators defined there.

#### Scenario: Root script inventory
- **WHEN** examining root `package.json` scripts
- **THEN** each script uses `bun run`, `bun test`, `tsc`, or `biome` — no references to yarn, npx, nx, lerna, or jest
- **AND** build scripts include: `build`, `build:extract`, `build:ts`, `build:all`, `build:showcase`
- **AND** the raw test script `test` exists (delegates to `bun test` with no path args)
- **AND** utility scripts include: `clean`, `clean:light`, `clean:full`, `rebuild`, `compile`, `lint`, `format`, `check`, `check:fix`
- **AND** verification atomic-tier scripts include: `verify:lint`, `verify:compile`, `verify:types`, `verify:unit:rust`, `verify:unit:ts`, `verify:canary`, `verify:integration`, `verify:build:next`, `verify:build:showcase`, `verify:assert:next`, `verify:assert:showcase`
- **AND** verification composite scripts include: `verify`, `verify:full`, `verify:ci`, `verify:next`, `verify:showcase`
- **AND** orphaned pre-policy scripts `test:canary`, `test:next`, `test:showcase`, `test:types`, `test:rust` do NOT exist (removed in atomic cutover per `verification-tier-policy`)

### Requirement: No orchestration tools
The repository SHALL NOT depend on NX, Lerna, or equivalent monorepo orchestration tools. Their configuration files (nx.json, lerna.json) SHALL NOT exist.

#### Scenario: Clean config
- **WHEN** listing root configuration files
- **THEN** nx.json and lerna.json do not exist
- **THEN** package.json devDependencies contain no nx, @nrwl/*, or lerna entries

