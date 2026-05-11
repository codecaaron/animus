## ADDED Requirements

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
The root `package.json` SHALL contain no more than 6 scripts covering: build, test, type-check, lint, format, and dev. Script commands SHALL use `bun` (not yarn, npx, or nx).

#### Scenario: Root script inventory
- **WHEN** examining root `package.json` scripts
- **THEN** each script uses `bun run`, `bun test`, `tsc`, or `biome` — no references to yarn, npx, nx, lerna, or jest

### Requirement: No orchestration tools
The repository SHALL NOT depend on NX, Lerna, or equivalent monorepo orchestration tools. Their configuration files (nx.json, lerna.json) SHALL NOT exist.

#### Scenario: Clean config
- **WHEN** listing root configuration files
- **THEN** nx.json and lerna.json do not exist
- **THEN** package.json devDependencies contain no nx, @nrwl/*, or lerna entries
