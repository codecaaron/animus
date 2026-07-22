# arch-workspace-topology Specification

## Purpose
TBD - created by archiving change enforce-workspace-topology. Update Purpose after archive.
## Requirements
### Requirement: Workspace dependency boundaries have an executable check

The repository SHALL provide a named executable check that rejects source imports,
TypeScript path aliases, and workspace package dependencies that violate the documented
dependency direction among `packages/`, `e2e/`, and `legacy/`.

#### Scenario: Forbidden package-to-e2e dependency fails

- **WHEN** a package source file, TypeScript alias, or workspace dependency points from `packages/*` to `e2e/*`
- **THEN** the workspace-topology check SHALL exit non-zero
- **AND** its output SHALL identify the offending file

#### Scenario: Active code cannot depend on legacy

- **WHEN** source under `packages/*` or `e2e/*` references a path under `legacy/*`
- **THEN** the workspace-topology check SHALL exit non-zero
- **AND** its output SHALL identify the offending file

#### Scenario: Current dependency direction passes

- **WHEN** `e2e/*` consumes `packages/*` without any reverse or legacy dependency
- **THEN** the workspace-topology check SHALL exit zero

### Requirement: Workspace topology enforcement joins repository verification

The workspace-topology check SHALL be reachable through a named repository verification
command and SHALL fail loud without silently repairing or rebuilding inputs.

#### Scenario: Maintainer runs the topology verifier

- **WHEN** a maintainer invokes the named verification command
- **THEN** it SHALL run the workspace boundary scan
- **AND** any violation SHALL make the command exit non-zero with an actionable path list

