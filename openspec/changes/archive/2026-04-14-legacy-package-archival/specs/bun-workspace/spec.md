## MODIFIED Requirements

### Requirement: Bun workspace script execution
The monorepo SHALL use Bun's native workspace features for running scripts across packages. No dedicated orchestration tool (NX, Lerna, Turborepo) SHALL be required.

The workspace SHALL exclude packages located under `legacy/` at the repository root. `bun run build` SHALL build only packages present in the root `package.json` `workspaces` array — legacy packages SHALL NOT be included in any cross-workspace script dispatch.

#### Scenario: Run build across all packages

- **WHEN** a developer runs `bun run build` from the root
- **THEN** all active workspace packages are built in dependency order
- **AND** no package under `legacy/` is built

#### Scenario: Run script in specific package

- **WHEN** a developer runs `bun run --filter @animus-ui/system build`
- **THEN** only the `packages/system` build script executes

#### Scenario: Filter does not resolve legacy packages

- **WHEN** a developer runs `bun run --filter @animus-ui/core build`
- **THEN** bun reports no matching workspace (since `@animus-ui/core` resides under `legacy/` and is excluded from the workspace graph)

## ADDED Requirements

### Requirement: Workspace Array Excludes Legacy Paths

The root `package.json` `workspaces` array SHALL NOT contain any entry whose path begins with `legacy/`. Additions to the workspaces array SHALL be reviewed against this rule.

#### Scenario: Workspaces array shape

- **WHEN** a maintainer reads the root `package.json` `workspaces` field
- **THEN** every entry refers to a path under `packages/` or (when the `e2e-workspace-topology` change is applied) under `e2e/`
- **AND** no entry refers to a path under `legacy/`
