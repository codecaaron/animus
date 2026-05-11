## MODIFIED Requirements

### Requirement: Bun as package manager

The monorepo SHALL use Bun as the sole package manager. `bun install` SHALL resolve all workspace dependencies and produce a `bun.lock` lockfile. No other package manager lockfiles (yarn.lock, package-lock.json) SHALL exist in the repository.

#### Scenario: Clean install

- **WHEN** a developer runs `bun install` from the repository root
- **THEN** all workspace packages and their dependencies are installed, and `bun.lock` is created

#### Scenario: Workspace dependency resolution

- **WHEN** `@animus-ui/theming` declares a dependency on `@animus-ui/core`
- **THEN** Bun resolves it to the local workspace package (not a registry version)

### Requirement: Simplified root scripts

The root `package.json` `scripts` block SHALL be split between MIGRATED tasks (defined in `vite.config.ts` `run.tasks`, ABSENT from `package.json` `scripts`) and UNMIGRATED tasks (PRESENT in `package.json` `scripts`, NOT migrated to vp).

Migrated tasks: every `verify:*` (atomic tiers + composite orchestrators), `build:*` (build:all, build:extract, build:ts, build:showcase, rebuild), and `hygiene`. After migration, NONE of these names appear in `package.json` `scripts`; their canonical invocation is `vp run <task>`.

Unmigrated tasks: `clean`, `clean:light`, `clean:full` (destructive shells, must always execute); `dev:showcase` (long-running watch); `test` (bun test, future migration); `lint`, `format`, `check`, `check:fix` (biome wrappers, separate future migration); `release` (one-shot release.sh); `deploy:showcase` (one-shot deploy). These keep their `package.json` entries and `bun run X` invocation surface.

#### Scenario: Root script inventory

- **WHEN** examining root `package.json` `scripts`
- **THEN** tier-related migrated names (`verify:*`, `build:*`, `hygiene`, composite orchestrators) DO NOT appear in `scripts`
- **AND** unmigrated entries (`clean*`, `dev:showcase`, `test`, `lint`, `format`, `check`, `check:fix`, `release`, `deploy:showcase`) DO appear with their existing command bodies
- **AND** `bun.lock`-related operations and `--filter` ad-hoc dispatch remain bun-native
- **AND** no references to yarn, npx, nx, lerna, or jest exist in any script

### Requirement: No competing orchestration tools

The repository SHALL NOT depend on multiple competing task-graph orchestration tools simultaneously. Vite+ (`vp` CLI) is the designated orchestrator. NX, Lerna, Turborepo, Moon, or equivalent monorepo orchestration tools SHALL NOT be installed alongside Vite+. Their configuration files (`nx.json`, `lerna.json`, `turbo.json`, `moon.yml`) SHALL NOT exist unless one of them replaces Vite+ in a future rebind change.

Bun retains its identity as the package manager and workspace resolver — Bun's `bun install`, `bun.lock`, and `--filter` operations are NOT considered competing orchestration tools because Bun's role and Vite+'s role are non-overlapping (package manager vs task-graph orchestrator).

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
- **AND** `bun.lock` continues to be the lockfile of record
- **AND** the workspace topology defined in this spec is preserved
