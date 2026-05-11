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

The monorepo SHALL use Bun's native workspace features for resolving the workspace dependency graph. Cross-workspace task dispatch (running a script across multiple packages in dependency order) is owned by Vite+ via the `vp run` task graph; ad-hoc per-package dispatch via `bun run --filter` continues to work for individual-package developer workflows but is NOT the canonical multi-package orchestration surface.

The workspace SHALL include active packages from `packages/` and consumer fixture apps from `e2e/`. It SHALL exclude packages located under `legacy/` at the repository root. `vp run build:all` SHALL build only packages present in the root `package.json` `workspaces` array — legacy packages SHALL NOT be included in any cross-workspace orchestration regardless of dispatch surface. The migrated `build:*` tasks live ONLY in `vite.config.ts` `run.tasks`; `bun run build:*` returns "script not found" post-migration by design (hard cutover).

#### Scenario: Run build across active packages

- **WHEN** a developer runs `vp run build:ts` from the root
- **THEN** all active workspace packages with a `build:ts` script (from `packages/` and `e2e/`) build in dependency order
- **AND** no package under `legacy/` is built
- **AND** `bun run build:ts` returns "script not found" (no `package.json` entry — the migrated task name lives only in `vite.config.ts`)

#### Scenario: Run script in specific active package

- **WHEN** a developer runs `bun run --filter '@animus-ui/system' build`
- **THEN** only the `packages/system` build script executes
- **AND** this ad-hoc dispatch path remains valid for per-package work

#### Scenario: Filter resolves e2e workspace member

- **WHEN** a developer runs `bun run --filter '@animus-ui/next-app' build`
- **THEN** bun resolves the `@animus-ui/next-app` workspace to its location under `e2e/next-app/`
- **AND** only that build script executes

#### Scenario: Filter does not resolve legacy packages

- **WHEN** a developer runs `bun run --filter '@animus-ui/core' build`
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

The root `package.json` `scripts` block SHALL be split between MIGRATED tasks (defined in `vite.config.ts` `run.tasks`, ABSENT from `package.json` `scripts`) and UNMIGRATED tasks (PRESENT in `package.json` `scripts`, NOT migrated to vp).

Migrated tasks: every `verify:*` (atomic tiers + composite orchestrators), `build:*` (build:all, build:extract, build:ts, build:showcase, rebuild), and `hygiene`. After migration, NONE of these names appear in `package.json` `scripts`; their canonical invocation is `vp run <task>`.

Unmigrated tasks: `clean`, `clean:light`, `clean:full` (destructive shells, must always execute); `dev:showcase` (long-running watch); `test` (bun test, future migration); `lint`, `format`, `check`, `check:fix` (biome wrappers, separate future migration); `release` (one-shot release.sh); `deploy:showcase` (one-shot deploy). These keep their `package.json` entries and `bun run X` invocation surface.

#### Scenario: Root script inventory

- **WHEN** examining root `package.json` `scripts`
- **THEN** tier-related migrated names (`verify:*`, `build:*`, `hygiene`, composite orchestrators) DO NOT appear in `scripts`
- **AND** unmigrated entries (`clean*`, `dev:showcase`, `test`, `lint`, `format`, `check`, `check:fix`, `release`, `deploy:showcase`) DO appear with their existing command bodies
- **AND** `bun.lockb`-related operations and `--filter` ad-hoc dispatch remain bun-native
- **AND** no references to yarn, npx, nx, lerna, or jest exist in any script

### Requirement: No competing orchestration tools

The repository SHALL NOT depend on multiple competing task-graph orchestration tools simultaneously. Vite+ (`vp` CLI) is the designated orchestrator. NX, Lerna, Turborepo, Moon, or equivalent monorepo orchestration tools SHALL NOT be installed alongside Vite+. Their configuration files (`nx.json`, `lerna.json`, `turbo.json`, `moon.yml`) SHALL NOT exist unless one of them replaces Vite+ in a future rebind change.

Bun retains its identity as the package manager and workspace resolver — Bun's `bun install`, `bun.lockb`, and `--filter` operations are NOT considered competing orchestration tools because Bun's role and Vite+'s role are non-overlapping (package manager vs task-graph orchestrator).

#### Scenario: No competing orchestrator configs

- **WHEN** listing root configuration files
- **THEN** Vite+'s configuration (`vite.config.ts` or equivalent) is the only task-graph-orchestrator configuration file present
- **AND** `nx.json`, `lerna.json`, `turbo.json`, `moon.yml` do NOT exist
- **AND** `package.json` `devDependencies` does not contain entries for `nx`, `@nrwl/*`, `lerna`, `turbo`, `@moonrepo/*`, or any equivalent orchestrator other than `vite-plus`

### Requirement: Binding to orchestration-architecture

The script-execution and workspace-resolution surfaces defined in this spec are realized through the orchestrator binding designated by the `orchestration-architecture` capability. The current binding uses `bun` exclusively (`bun install`, `bun run`, `bun run --filter`, `bun test`). A future rebind to a different orchestrator (e.g., Vite+ via the `migrate-orchestrator-to-vp-run` follow-on policy change) SHALL preserve every requirement in this spec that is not explicitly modified by the rebind change.

The package-manager identity (Bun) and workspace-resolution mechanism (Bun's workspaces feature) SHALL remain owned by this spec regardless of orchestrator rebind. The orchestration semantics — specifically, the choice of which CLI dispatches tasks across the workspace — are owned by `orchestration-architecture` and may move out of `bun run`'s purview when a rebind lands.

#### Scenario: Bun remains the package manager after orchestrator rebind

- **WHEN** a cutover follow-on rebinds the orchestrator (e.g., to `vp run`)
- **THEN** `bun install` continues to resolve workspace dependencies
- **AND** `bun.lockb` continues to be the lockfile of record
- **AND** the workspace topology defined in this spec is preserved

