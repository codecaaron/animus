## Why

Each Git-connected Cloudflare Worker currently recompiles the same Rust/NAPI V2 dependency graph for every commit, multiplying a multi-minute cold build across four services. A single scheduled deployment authority can reuse one shared build, preserve independent Worker targets, and keep remote deployment health separate from npm release eligibility.

## What Changes

- Add a manual-and-nightly `main` workflow that builds shared prerequisites once and validates every Worker before deployment.
- Add an aggregate deployment script that attempts all four same-SHA Worker deployments and reports partial failures.
- Retain Cloudflare Git Builds until the replacement succeeds from `main`, then cut over through an explicit operational gate.

## Capabilities

### New Capabilities

- `scheduled-worker-deployment`: Same-SHA validation, scheduling, credential boundaries, and aggregate deployment behavior for the four Worker targets.

### Modified Capabilities

- None.

## Impact

Affected surfaces are `.github/workflows/`, `scripts/deploy/`, Worker structural tests, the Worker operations runbook, and Cloudflare/GitHub Actions deployment configuration. No public package API or npm release prerequisite changes.
