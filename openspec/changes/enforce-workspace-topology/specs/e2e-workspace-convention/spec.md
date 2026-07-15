## MODIFIED Requirements

### Requirement: One-Way Dependency Rule

Source code in `e2e/*` MAY import from `packages/*`. Source code in `packages/*` MUST NOT import from `e2e/*`. Source code in `packages/*` and `e2e/*` MUST NOT import from `legacy/*`.

This rule mirrors the publish boundary: `packages/*` is the publish graph (plus deep-internal private packages); `e2e/*` is downstream verification infrastructure. Dependencies flow top-down (consumer direction). A named executable workspace-topology check SHALL enforce the rule across source imports, TypeScript path aliases, and workspace package dependencies.

#### Scenario: e2e imports packages

- **WHEN** a file in `e2e/next-app/src/` imports `@animus-ui/system`
- **THEN** the import is permitted (top-down, consumer direction)

#### Scenario: packages does NOT import e2e

- **WHEN** a file in `packages/system/src/` attempts to import from `e2e/next-app/`
- **THEN** the workspace-topology check SHALL reject the change
- **AND** the check output SHALL identify the offending file

#### Scenario: Neither imports legacy

- **WHEN** a file in `packages/` or `e2e/` imports from any `legacy/` path or any `@animus-ui/<archived-name>`
- **THEN** the workspace-topology check SHALL reject the change
- **AND** the check output SHALL identify the offending file
