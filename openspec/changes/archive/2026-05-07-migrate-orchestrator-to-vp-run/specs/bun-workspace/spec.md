## MODIFIED Requirements

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

### Requirement: Simplified root scripts

The root `package.json` `scripts` block SHALL be split between MIGRATED tasks (defined in `vite.config.ts` `run.tasks`, ABSENT from `package.json` `scripts`) and UNMIGRATED tasks (PRESENT in `package.json` `scripts`, NOT migrated to vp).

Migrated tasks: every `verify:*` (atomic tiers + composite orchestrators), `build:*` (build:all, build:extract, build:ts, build:showcase, rebuild), and `hygiene`. After migration, NONE of these names appear in `package.json` `scripts`; their canonical invocation is `vp run <task>`.

Unmigrated tasks: `clean`, `clean:light`, `clean:full` (destructive shells, must always execute); `dev:showcase` (long-running watch); `test` (bun test, future migration); `compile` (workspace-filter ad-hoc alias); `lint`, `format`, `check`, `check:fix` (biome wrappers, separate future migration); `release` (one-shot release.sh); `deploy:showcase` (one-shot deploy); `compile:tsc-fallback` and `verify:compile:tsc-fallback` (slated for removal). These keep their `package.json` entries and `bun run X` invocation surface.

#### Scenario: Root script inventory

- **WHEN** examining root `package.json` `scripts`
- **THEN** tier-related migrated names (`verify:*`, `build:*`, `hygiene`, composite orchestrators) DO NOT appear in `scripts`
- **AND** unmigrated entries (`clean*`, `dev:showcase`, `test`, `compile`, `lint`, `format`, `check`, `check:fix`, `release`, `deploy:showcase`) DO appear with their existing command bodies
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
