## ADDED Requirements

### Requirement: Framework-named Worker fixtures

The end-to-end workspace set SHALL include isolated applications at `e2e/vinext-app` and `e2e/react-router-app`.

#### Scenario: Select the Vinext workspace

- **WHEN** a maintainer runs a Bun workspace filter for `@animus-ui/vinext-app`
- **THEN** Bun selects only `e2e/vinext-app`

#### Scenario: Select the React Router workspace

- **WHEN** a maintainer runs a Bun workspace filter for `@animus-ui/react-router-app`
- **THEN** Bun selects only `e2e/react-router-app`

### Requirement: New framework fixtures remain self-contained

Each new framework fixture SHALL build without resolving source files from another `e2e/*` application.

#### Scenario: Build fixtures independently

- **WHEN** each new fixture's focused build runs after shared packages are available
- **THEN** the build completes using only its own source plus active `packages/*` workspace dependencies
