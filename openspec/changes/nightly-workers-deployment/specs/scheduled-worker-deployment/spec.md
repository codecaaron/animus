## ADDED Requirements

### Requirement: Main-only scheduled Worker deployment

The deployment workflow SHALL run nightly or by manual dispatch only for the repository's `main` ref.

#### Scenario: Nightly run selects main

- **WHEN** the repository scheduler starts the Worker deployment workflow
- **THEN** the workflow builds and deploys the current `main` commit

#### Scenario: Manual dispatch rejects another ref

- **WHEN** a maintainer manually dispatches the workflow for a ref other than `main`
- **THEN** the workflow exits before building or deploying a Worker

### Requirement: Shared prerequisites build once

Each deployment run SHALL build the V2 NAPI binary and shared TypeScript packages once before building the four Worker applications.

#### Scenario: Inspect a completed workflow log

- **WHEN** a maintainer inspects a completed deployment workflow run
- **THEN** the log contains one V2 NAPI build and one shared TypeScript build before the four application builds
- **AND** the log contains no V1 NAPI build

### Requirement: Validation precedes remote mutation

The deployment run SHALL complete production builds, output assertions, and credential-free Wrangler dry-runs for all four Worker targets before invoking any remote deploy command.

#### Scenario: One target fails validation

- **WHEN** any Worker build, assertion, or dry-run command exits non-zero
- **THEN** the workflow exits non-zero without invoking a remote deploy command for any target

#### Scenario: Every target passes validation

- **WHEN** all four Worker targets pass their builds, assertions, and dry-runs
- **THEN** the workflow proceeds to the deployment phase

### Requirement: Same-SHA independent deployment attempts

The deployment phase SHALL attempt `animus`, `animus-vite-canary`, `animus-vinext-canary`, and `animus-react-router-canary` from the workflow's source SHA and report aggregate success or failure.

#### Scenario: Every deployment succeeds

- **WHEN** all four Wrangler deploy commands exit successfully
- **THEN** the workflow succeeds and its deployment log records the same source SHA for all four targets

#### Scenario: One deployment fails

- **WHEN** one Worker deploy command exits non-zero
- **THEN** the workflow still attempts the other independently named Worker deployments
- **AND** the workflow exits non-zero after all four attempts

### Requirement: Deployment credentials fail closed

The deployment workflow SHALL require the Cloudflare account identifier and API token through the repository's encrypted Actions secret boundary.

#### Scenario: A required credential is absent

- **WHEN** either required Actions secret is unavailable to the workflow
- **THEN** credential preflight exits non-zero before building or deploying any Worker
