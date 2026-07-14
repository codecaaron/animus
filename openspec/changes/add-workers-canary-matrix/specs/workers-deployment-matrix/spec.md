## ADDED Requirements

### Requirement: Independent Worker deployment targets

The repository SHALL expose independently buildable and deployable Worker targets named `animus`, `animus-vite-canary`, `animus-vinext-canary`, and `animus-react-router-canary`.

#### Scenario: Build one target without deploying another

- **WHEN** a maintainer runs the focused build command for any one target
- **THEN** that application's production output is created without building or deploying the other three applications

#### Scenario: Dry-run one target

- **WHEN** a maintainer runs the focused deployment dry run for any one target
- **THEN** the command identifies that target's Worker name and produces deployable Worker metadata without changing remote state

### Requirement: Showcase SPA Worker behavior

Worker `animus` SHALL serve the production showcase assets and return the SPA entry document for client-side application routes that do not match a physical asset.

#### Scenario: Serve the root document

- **WHEN** an HTTP client requests `/` from the locally previewed or deployed `animus` Worker
- **THEN** the response is successful and contains the showcase entry document

#### Scenario: Serve a deep client route

- **WHEN** an HTTP client directly requests a known showcase client route with no matching file
- **THEN** the response is successful and contains the showcase entry document rather than a Worker 404

### Requirement: Framework-generated Worker output remains deployable

Each full-stack canary SHALL produce Worker code and asset metadata accepted by its credential-free deployment dry run.

#### Scenario: Validate all full-stack bundles

- **WHEN** the Vite, Vinext, and React Router production builds and focused deployment dry runs complete
- **THEN** every dry run exits successfully with one Worker bundle and its associated client assets

### Requirement: Workers are reproducible from repository commands

A clean workspace SHALL be able to install dependencies, build any Worker target, and execute its deployment dry run through checked-in commands without dashboard-only filesystem steps.

#### Scenario: No lockfile-copy workaround

- **WHEN** a Worker target is built and dry-run from the repository root after `bun install`
- **THEN** the command succeeds without copying or converting `bun.lock`
