## ADDED Requirements

### Requirement: Shared Assertions Workspace Package

A private workspace package SHALL exist at `packages/_assertions/` with the name `@animus-ui/assertions`. It SHALL be the shared home for assertion utilities importable by both post-build scripts (in `packages/*`) and consumer fixture apps (in `e2e/*`).

#### Scenario: Package exists and is private

- **WHEN** a maintainer inspects `packages/_assertions/package.json`
- **THEN** the name field is `@animus-ui/assertions`
- **AND** `private: true` is set
- **AND** no `publishConfig.access: public` is present

#### Scenario: Registered in workspaces

- **WHEN** a maintainer reads the root `package.json` `workspaces` array
- **THEN** `packages/_assertions` is present (or resolved via a `packages/*` glob)

### Requirement: Underscore-Prefix Convention Alignment

`packages/_assertions/` SHALL follow the `packages/_*` underscore-prefix convention that denotes internal-not-published packages, joining `packages/_integration/`. Any new internal-not-published workspace package under `packages/` SHALL use the underscore prefix to maintain the convention.

#### Scenario: Prefix indicates internal

- **WHEN** a maintainer encounters `packages/_assertions/`
- **THEN** the underscore prefix signals internal-not-published by convention
- **AND** the `private: true` flag confirms the signal

### Requirement: Initial Scaffold Contents

Immediately after this change is applied, `packages/_assertions/` SHALL contain:

- `package.json` — name, private flag, build scripts (`tsdown && tsc -p tsconfig.build.json`), dependencies as needed (likely `@animus-ui/properties` `workspace:*`, optionally `@animus-ui/system` `workspace:*`)
- `src/index.ts` — a scaffold file containing a header comment and a near-empty export barrel (see Scaffold Header Banner requirement)
- `tsconfig.json` and `tsconfig.build.json` following the pattern of other private packages
- `CLAUDE.md` — a short note stating the scaffold-only status and pointing to `integration-test-infrastructure` as the change that populates the package

No actual assertion utility code SHALL be added in this change.

#### Scenario: Scaffold present, no content

- **WHEN** a maintainer inspects `packages/_assertions/src/`
- **THEN** `index.ts` exists
- **AND** it contains only an empty export or a single placeholder export
- **AND** no assertion utility functions are yet defined

#### Scenario: Scaffold CLAUDE.md explains status

- **WHEN** an agent reads `packages/_assertions/CLAUDE.md`
- **THEN** the file states "Scaffold only" and references `integration-test-infrastructure` as the source of forthcoming content

### Requirement: Scaffold Header Banner

`packages/_assertions/src/index.ts` SHALL begin with a header comment naming the package's scaffold-only status and directing readers to the package `CLAUDE.md` and the `integration-test-infrastructure` change. The header MUST appear before any export statement. This closes the rediscovery gap for agents who encounter the file without reading the neighboring `CLAUDE.md`.

#### Scenario: Header comment present

- **WHEN** an agent reads `packages/_assertions/src/index.ts`
- **THEN** the first non-blank content is a comment identifying the file as scaffold-only AND referencing `CLAUDE.md` and `integration-test-infrastructure`
- **AND** the agent receives the scaffold signal even without opening `CLAUDE.md`

### Requirement: Assertion Library Does Not Import From e2e

`packages/_assertions/` SHALL NOT import from any path under `e2e/`. This preserves the one-way dependency rule that makes `_assertions` safely consumable by both `packages/*` post-build scripts and `e2e/*` fixtures. If a utility in `_assertions` needs to describe a shape defined in `e2e/*` (e.g., a fixture manifest type), the shape SHALL be defined in `_assertions` and imported by `e2e/*` — never the reverse.

#### Scenario: No e2e import

- **WHEN** a maintainer greps `packages/_assertions/src/**` for `from '..'` / `from '../..'` / `e2e/` / any path reaching outside `packages/`
- **THEN** no import resolves to a path under `e2e/`

#### Scenario: Types flow top-down

- **WHEN** a utility in `_assertions` needs to describe a fixture shape
- **THEN** the type is declared in `_assertions` and imported by the consuming `e2e/*` script
- **AND** `_assertions` does NOT import the type from `e2e/*`

### Requirement: Importable from Both Packages and e2e

The package SHALL be importable as `@animus-ui/assertions` from:

- Post-build scripts in `packages/*` (e.g., future TS rewrites of `scripts/assert-showcase.sh`)
- Fixture apps in `e2e/*` (e.g., `e2e/next-app/scripts/` and future `e2e/vite-app/scripts/`)
- Integration tests in `packages/_integration/`

This pattern keeps all imports flowing top-down (from consumer toward shared infrastructure) and does not cross the `packages/ ← e2e/` one-way boundary.

#### Scenario: e2e script imports assertions

- **WHEN** a script at `e2e/next-app/scripts/assert-next-build.ts` imports `@animus-ui/assertions`
- **THEN** the import resolves via the workspace to `packages/_assertions/dist/index.js`

#### Scenario: packages post-build script imports assertions

- **WHEN** a future TS script at `scripts/assert-showcase.ts` imports `@animus-ui/assertions`
- **THEN** the import resolves via the workspace without crossing into `e2e/`

### Requirement: Build Pipeline Inclusion

`packages/_assertions/` SHALL be included in the root `bun run build:ts` command (via workspace filter). Its build output SHALL be generated and type-definitions emitted on the same lifecycle as other TS packages.

#### Scenario: Build output is produced

- **WHEN** a developer runs `bun run build:ts`
- **THEN** `packages/_assertions/dist/index.js` and `packages/_assertions/dist/index.d.ts` are produced
- **AND** importers in the workspace can resolve `@animus-ui/assertions`

### Requirement: No Utilities Implemented in This Change

This change SHALL NOT add any concrete assertion utilities to `packages/_assertions/src/`. Utilities are the scope of the subsequent `integration-test-infrastructure` change. Adding utilities in this change would expand scope beyond topology.

#### Scenario: Scope check

- **WHEN** a reviewer inspects the diff of this change
- **THEN** `packages/_assertions/src/index.ts` contains only the scaffold export
- **AND** no positional-layer-order helper, class-name helper, or placeholder-guard helper is present
