## MODIFIED Requirements

### Requirement: Bun workspace script execution
The monorepo SHALL use Bun's native workspace features for running scripts across packages. No dedicated orchestration tool (NX, Lerna, Turborepo) SHALL be required.

The workspace SHALL include active packages from `packages/` and consumer fixture apps from `e2e/`. It SHALL exclude packages located under `legacy/` at the repository root. `bun run build` SHALL build only packages present in the root `package.json` `workspaces` array.

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

## ADDED Requirements

### Requirement: Workspace Array Includes e2e Paths

The root `package.json` `workspaces` array SHALL include entries (either explicit paths or via glob expansion) for `e2e/*` consumer fixture applications. At minimum, after this change, the array SHALL include `e2e/next-app`.

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
