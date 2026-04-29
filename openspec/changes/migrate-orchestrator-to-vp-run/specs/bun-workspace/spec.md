## MODIFIED Requirements

### Requirement: Bun workspace script execution

The monorepo SHALL use Bun's native workspace features for resolving the workspace dependency graph. Cross-workspace task dispatch (running a script across multiple packages in dependency order) is owned by Vite+ via the `vp run` task graph; ad-hoc per-package dispatch via `bun run --filter` continues to work for individual-package developer workflows but is NOT the canonical multi-package orchestration surface.

The workspace SHALL include active packages from `packages/` and consumer fixture apps from `e2e/`. It SHALL exclude packages located under `legacy/` at the repository root. `vp run build` (and equivalently `bun run build` via the `package.json` script alias) SHALL build only packages present in the root `package.json` `workspaces` array — legacy packages SHALL NOT be included in any cross-workspace orchestration regardless of dispatch surface.

#### Scenario: Run build across active packages

- **WHEN** a developer runs `vp run build:ts` from the root (or `bun run build:ts` as transparent alias)
- **THEN** all active workspace packages with a `build:ts` script (from `packages/` and `e2e/`) build in dependency order
- **AND** no package under `legacy/` is built

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

The root `package.json` SHALL contain scripts organized by verb:scope naming convention. The script set SHALL cover: build (granular + all), test, type-check, lint, format, clean, and verification via the tier policy. Tier-related scripts SHALL invoke Vite+ via `vp run <task>` as their command body — the `bun` and `bunx` direct invocations are preserved for `clean*` (shell-direct), Bun-native operations (`bun install`, `bun.lockb`-related work), and the `--filter`-based ad-hoc per-package dispatch path.

Verification is handled by the `verification-tier-policy` capability (atomic tiers + composite orchestrators named `verify:<tier>[:<scope>]`); the root script set MUST include both the atomic tiers and the composite orchestrators defined there, all routed through `vp run` as their script body.

#### Scenario: Root script inventory

- **WHEN** examining root `package.json` scripts
- **THEN** tier-related scripts (`verify:*`, `build:*`, `test`, `lint*`, `hygiene`, composite orchestrators) have `vp run <task>` as their command body
- **AND** `bun.lockb`-related operations and `--filter` ad-hoc dispatch remain bun-native
- **AND** `clean*` scripts use direct shell (`rm -rf`) invocations
- **AND** no references to yarn, npx, nx, lerna, or jest exist in any script

### Requirement: No competing orchestration tools

The repository SHALL NOT depend on multiple competing task-graph orchestration tools simultaneously. Vite+ (`vp` CLI) is the designated orchestrator. NX, Lerna, Turborepo, Moon, or equivalent monorepo orchestration tools SHALL NOT be installed alongside Vite+. Their configuration files (`nx.json`, `lerna.json`, `turbo.json`, `moon.yml`) SHALL NOT exist unless one of them replaces Vite+ in a future rebind change.

Bun retains its identity as the package manager and workspace resolver — Bun's `bun install`, `bun.lockb`, and `--filter` operations are NOT considered competing orchestration tools because Bun's role and Vite+'s role are non-overlapping (package manager vs task-graph orchestrator).

#### Scenario: No competing orchestrator configs

- **WHEN** listing root configuration files
- **THEN** Vite+'s configuration (`vp.config.ts` or equivalent) is the only task-graph-orchestrator configuration file present
- **AND** `nx.json`, `lerna.json`, `turbo.json`, `moon.yml` do NOT exist
- **AND** `package.json` `devDependencies` does not contain entries for `nx`, `@nrwl/*`, `lerna`, `turbo`, `@moonrepo/*`, or any equivalent orchestrator other than `vite-plus`
