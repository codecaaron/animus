## MODIFIED Requirements

### Requirement: Package configuration
The test app SHALL be a private workspace package at `e2e/next-app/` with `next`, `react`, `react-dom` as dependencies and `@animus-ui/system` and `@animus-ui/next-plugin` as dependencies.

#### Scenario: Package is private
- **WHEN** the package.json is inspected
- **THEN** it SHALL have `"private": true` and SHALL NOT be published to npm

#### Scenario: Workspace membership
- **WHEN** the root `package.json` workspaces array is inspected
- **THEN** it SHALL include `e2e/next-app`
- **AND** it SHALL NOT include any reference to `packages/next-test-app`

#### Scenario: Relocated from packages/
- **WHEN** a maintainer locates the next-app test fixture
- **THEN** it resides at `e2e/next-app/`, not `packages/next-test-app/`
- **AND** git history for files within the package traces via `git log --follow` back to the `packages/next-test-app/` path
