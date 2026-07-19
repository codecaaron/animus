## MODIFIED Requirements

### Requirement: CI publish pipeline alignment

The CI release job SHALL retain the authoritative publishable package set and SHALL materialize one immutable tarball bundle, verify that supplied bundle, and publish those exact paths in dependency order. A parsed CI topology contract SHALL fail if bundle materialization, supplied-tarball verification, publication paths/order, or required release gates drift while verification orchestration is simplified.

#### Scenario: Prerelease tags publish to npm `next`

- **WHEN** CI processes a prerelease tag
- **THEN** every verified tarball is published with `--tag next`

#### Scenario: Stable tags publish to npm `latest`

- **WHEN** CI processes a stable tag
- **THEN** every verified tarball is published with `--tag latest`

#### Scenario: Release topology contract detects reordered proof

- **WHEN** CI publication is moved before supplied-tarball verification or a publish path no longer names the release bundle
- **THEN** the parsed CI topology contract fails before the workflow change can be accepted

### Requirement: Release gate composition

The CI release job SHALL remain blocked on the existing source, Rust hygiene/Clippy, repository verify, Next, Vite, supported Worker, and packed consumer jobs. Verification command ownership changes SHALL NOT remove or rename those job dependencies.

#### Scenario: A gating job fails on a release tag

- **WHEN** any required job fails
- **THEN** the release job does not run and nothing is published

#### Scenario: Full gate green on a release tag

- **WHEN** every required job succeeds
- **THEN** the release job may proceed to its immutable bundle proof and publication

### Requirement: Consumer lanes run on every CI run

The Next, Vite, supported Worker, and packed consumer jobs SHALL remain scheduled for every workflow event they currently cover. CI MAY invoke package-owned phase diagnostics for a lane whose evidence boundary is build plus assertion and complete owner claims for the all-Worker gate; command relocation SHALL not change the job's trigger or receipt ownership.

#### Scenario: CI workflow triggered

- **WHEN** any configured CI event starts a run
- **THEN** the standing consumer jobs are scheduled without a release-only condition
- **AND** each job retains its existing receipt artifact path
