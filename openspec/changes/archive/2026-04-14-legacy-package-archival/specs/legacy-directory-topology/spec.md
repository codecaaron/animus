## ADDED Requirements

### Requirement: Legacy Directory Location

The repository SHALL contain a `legacy/` directory at the repository root, sibling to `packages/`. The `legacy/` directory SHALL hold packages that were previously part of the active development surface but are no longer included in the publish graph or the active workspace.

#### Scenario: Legacy directory is a top-level sibling

- **WHEN** a maintainer lists the repository root
- **THEN** `legacy/` appears as a top-level directory alongside `packages/`, `e2e/` (when present), `scripts/`, `openspec/`

#### Scenario: Archived packages reside under legacy

- **WHEN** a maintainer locates archived packages (core, theming, ui, _docs, runtime)
- **THEN** they are found under `legacy/<name>/`, not `packages/<name>/` or any other location

### Requirement: Initial Legacy Cluster

The following five packages SHALL reside under `legacy/` after this change:

- `legacy/core/` (previously `packages/core/`, published as `@animus-ui/core`)
- `legacy/theming/` (previously `packages/theming/`, published as `@animus-ui/theming`)
- `legacy/ui/` (previously `packages/ui/`, published as `@animus-ui/components`)
- `legacy/_docs/` (previously `packages/_docs/`)
- `legacy/runtime/` (previously `packages/runtime/`, published as `@animus-ui/runtime`)

Moves SHALL use `git mv` to preserve history as renames.

#### Scenario: Each legacy package is present post-move

- **WHEN** a maintainer navigates to the repository root after this change is applied
- **THEN** each of the five listed packages is present under `legacy/`
- **AND** none of the five is present under `packages/`

#### Scenario: Git history is preserved

- **WHEN** a maintainer runs `git log --follow legacy/core/src/<file>`
- **THEN** the history includes commits from when the file was located at `packages/core/src/<file>`

### Requirement: Legacy Packages Are Not in the Workspace Graph

No package under `legacy/` SHALL be present in the root `package.json` `workspaces` array. `bun install` SHALL NOT resolve, symlink, or install dependencies for any package under `legacy/`.

#### Scenario: Legacy packages are absent from workspaces

- **WHEN** a maintainer reads the root `package.json` `workspaces` array
- **THEN** no entry references a path beginning with `legacy/`
- **AND** no entry references the five archived package names

#### Scenario: Clean install skips legacy

- **WHEN** a developer runs `bun install` from a clean state
- **THEN** no symlinks are created for packages under `legacy/`
- **AND** `node_modules/@animus-ui/core` (and similar for the archived five) does not resolve to a workspace package

### Requirement: Legacy Packages Are Private

Every package under `legacy/` SHALL have `private: true` in its `package.json`. No package under `legacy/` SHALL have a `publishConfig` field granting publish access.

#### Scenario: Privacy flag present

- **WHEN** a maintainer reads the `package.json` of any package under `legacy/`
- **THEN** the file contains `"private": true`

#### Scenario: No publish config

- **WHEN** a maintainer reads the `package.json` of any package under `legacy/`
- **THEN** the file does NOT contain a `publishConfig` field with `access: public`

### Requirement: One-Way Independence Rule

No package under `packages/` or (once present) `e2e/` SHALL import from any package under `legacy/`. Legacy packages MAY import from each other; they MUST NOT be imported by active code.

#### Scenario: Active packages do not import legacy

- **WHEN** a maintainer greps `@animus-ui/(core|theming|components|docs|runtime)` across `packages/**` and `e2e/**` source files
- **THEN** no production source file (excluding generated dist, node_modules, archived openspec content, and Rust string-literal test fixtures) contains such an import

#### Scenario: CI or lint enforcement

- **WHEN** a future change enforces the one-way independence rule in CI
- **THEN** the enforcement MAY be implemented as a grep check, an ESLint rule, or equivalent
- **AND** it MUST fail the build if a `packages/*` or `e2e/*` source file imports from `@animus-ui/<legacy-package>`

### Requirement: Root CLAUDE.md Documents Legacy Convention

The root `CLAUDE.md` SHALL contain a `## Legacy Packages` (or equivalent) section that states:

- `legacy/` exists as a sibling to `packages/`
- Packages in `legacy/` are preserved for reference, not for runtime use
- The one-way independence rule
- Which packages currently reside in `legacy/`

#### Scenario: Agent reads the legacy convention

- **WHEN** an agent loads root `CLAUDE.md`
- **THEN** a section documents the `legacy/` directory and its semantics
- **AND** the agent can distinguish active packages from legacy without additional lookup

### Requirement: No Compatibility Aliases

No symlink, path alias, or module resolver rule SHALL redirect references like `packages/core` to `legacy/core`. Any remaining import of an archived package SHALL fail with a normal module-not-found error.

#### Scenario: Import of archived package fails cleanly

- **WHEN** source code imports `@animus-ui/core` (or any other archived package name) from a non-legacy file
- **THEN** the import fails with a standard module-resolution error
- **AND** no silent redirect occurs
