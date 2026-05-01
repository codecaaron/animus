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

The workspace SHALL include active packages from `packages/` and consumer fixture apps from `e2e/`. It SHALL exclude packages located under `legacy/` at the repository root. `bun run build` SHALL build only packages present in the root `package.json` `workspaces` array — legacy packages SHALL NOT be included in any cross-workspace script dispatch.

#### Scenario: Run build across active packages

- **WHEN** a developer runs `bun run build` from the root
- **THEN** all active workspace packages (from `packages/` and `e2e/`) are built in dependency order
- **AND** no package under `legacy/` is built

#### Scenario: Run script in specific active package

- **WHEN** a developer runs `bun run --filter @animus-ui/system build`
- **THEN** only the `packages/system` build script executes

#### Scenario: Filter resolves e2e workspace member

- **WHEN** a developer runs `bun run --filter @animus-ui/next-app build`
- **THEN** bun resolves the `@animus-ui/next-app` workspace to its location under `e2e/next-app/`
- **AND** only that build script executes

#### Scenario: Filter does not resolve legacy packages

- **WHEN** a developer runs `bun run --filter @animus-ui/core build`
- **THEN** bun reports no matching workspace (since `@animus-ui/core` resides under `legacy/` and is excluded from the workspace graph)

### Requirement: Workspace Array Excludes Legacy Paths

The root `package.json` `workspaces` array SHALL NOT contain any entry whose path begins with `legacy/`. Additions to the workspaces array SHALL be reviewed against this rule.

#### Scenario: Workspaces array shape

- **WHEN** a maintainer reads the root `package.json` `workspaces` field
- **THEN** every entry refers to a path under `packages/` or under `e2e/`
- **AND** no entry refers to a path under `legacy/`

### Requirement: Workspace Array Includes e2e Paths

The root `package.json` `workspaces` array SHALL include entries (either explicit paths or via glob expansion) for `e2e/*` consumer fixture applications. At minimum, the array SHALL include `e2e/next-app`.

#### Scenario: e2e entry present

- **WHEN** a maintainer reads the root `package.json` `workspaces` field
- **THEN** an entry covers `e2e/next-app` (either as an explicit `e2e/next-app` string or via a `e2e/*` glob)

### Requirement: Workspace Array Includes Shared Assertions Scaffold

The root `package.json` `workspaces` array SHALL include `packages/_assertions` (either as an explicit entry or via a `packages/*` glob). `@animus-ui/assertions` MUST be workspace-resolvable so consumers can import it via `workspace:*` dependency specifiers.

#### Scenario: Assertions scaffold entry present

- **WHEN** a maintainer reads the root `package.json` `workspaces` field
- **THEN** an entry covers `packages/_assertions`

#### Scenario: Workspace resolution for assertions

- **WHEN** another workspace declares `"@animus-ui/assertions": "workspace:*"` in its dependencies
- **THEN** `bun install` symlinks `node_modules/@animus-ui/assertions` to `packages/_assertions`

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
- **THEN** package.json devDependencies contain no nx, @nrwl/\*, or lerna entries
