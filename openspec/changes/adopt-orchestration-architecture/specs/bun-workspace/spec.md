## ADDED Requirements

### Requirement: Binding to orchestration-architecture

The script-execution and workspace-resolution surfaces defined in this spec are realized through the orchestrator binding designated by the `orchestration-architecture` capability. The current binding uses `bun` exclusively (`bun install`, `bun run`, `bun run --filter`, `bun test`). A future rebind to a different orchestrator (e.g., Vite+ via the `migrate-orchestrator-to-vp-run` follow-on policy change) SHALL preserve every requirement in this spec that is not explicitly modified by the rebind change.

The package-manager identity (Bun) and workspace-resolution mechanism (Bun's workspaces feature) SHALL remain owned by this spec regardless of orchestrator rebind. The orchestration semantics — specifically, the choice of which CLI dispatches tasks across the workspace — are owned by `orchestration-architecture` and may move out of `bun run`'s purview when a rebind lands.

#### Scenario: Bun remains the package manager after orchestrator rebind

- **WHEN** a cutover follow-on rebinds the orchestrator (e.g., to `vp run`)
- **THEN** `bun install` continues to resolve workspace dependencies
- **AND** `bun.lockb` continues to be the lockfile of record
- **AND** the workspace topology defined in this spec is preserved

## MODIFIED Requirements

### Requirement: Bun workspace script execution

The monorepo SHALL use Bun's native workspace features for resolving the workspace graph. Cross-workspace task dispatch (running a script across multiple packages in dependency order) is owned by the orchestrator designated by the `orchestration-architecture` capability — currently `bun run` and `bun run --filter`, with future rebind permitted via the orchestration follow-on policy changes.

The workspace SHALL include active packages from `packages/` and consumer fixture apps from `e2e/`. It SHALL exclude packages located under `legacy/` at the repository root. Cross-workspace script dispatch SHALL build only packages present in the root `package.json` `workspaces` array — legacy packages SHALL NOT be included in any cross-workspace script dispatch under any orchestrator binding.

#### Scenario: Run build across active packages

- **WHEN** a developer runs the orchestrator's full-build task at the root (currently `bun run build`)
- **THEN** all active workspace packages (from `packages/` and `e2e/`) are built in dependency order
- **AND** no package under `legacy/` is built

#### Scenario: Run script in specific active package

- **WHEN** a developer invokes the orchestrator's per-package dispatch (currently `bun run --filter @animus-ui/system build`)
- **THEN** only the `packages/system` build script executes

#### Scenario: Filter resolves e2e workspace member

- **WHEN** a developer invokes per-package dispatch for an e2e workspace (currently `bun run --filter @animus-ui/next-app build`)
- **THEN** the dispatch resolves the `@animus-ui/next-app` workspace to its location under `e2e/next-app/`
- **AND** only that build script executes

#### Scenario: Filter does not resolve legacy packages

- **WHEN** a developer invokes per-package dispatch targeting a legacy package (e.g., `@animus-ui/core` which resides under `legacy/`)
- **THEN** the dispatch reports no matching workspace
- **AND** no legacy build runs

### Requirement: No competing orchestration tools

The repository SHALL NOT depend on multiple competing orchestration tools simultaneously. The single orchestrator designated by `orchestration-architecture` is the sole owner of cross-workspace task dispatch. NX, Lerna, Turborepo, Moon, or equivalent tools SHALL NOT be installed alongside the designated orchestrator. Their configuration files (nx.json, lerna.json, turbo.json, moon.yml) SHALL NOT exist unless one of them IS the designated orchestrator per a future rebind change.

#### Scenario: No competing orchestrator configs

- **WHEN** listing root configuration files
- **THEN** at most one orchestrator's configuration file exists (e.g., currently no orchestrator config; post-`migrate-orchestrator-to-vp-run` cutover, only Vite+'s configuration would exist)
- **AND** `package.json` `devDependencies` does not contain entries for orchestrators not designated by `orchestration-architecture`
