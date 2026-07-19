## Purpose

Requirements for the `release-workflow` capability: Fixed versioning across all publishable packages; Semver bump types; Version derived from git tags; and 5 more.

## Requirements

### Requirement: Fixed versioning across all publishable packages

All publishable packages SHALL share a single version derived from the git tag. The release script SHALL stamp the same version into every publishable package's `package.json`.

#### Scenario: All packages receive the same version

- **WHEN** `bun release patch` is run and the current version is `0.1.0`
- **THEN** `properties`, `system`, `extract`, `vite-plugin`, and `next-plugin` SHALL all have `.version` set to `0.1.1`

#### Scenario: Legacy packages excluded

- **WHEN** a release is cut
- **THEN** `core`, `theming`, `runtime`, and `ui` SHALL NOT be updated or published — they are marked `private: true`

### Requirement: Semver bump types

The release script SHALL support standard semver bump types: `patch`, `minor`, `major`, `prepatch`, `preminor`, `premajor`, `prerelease`, and `graduate`.

#### Scenario: Stable bump from stable version

- **WHEN** current version is `0.1.1` and bump type is `minor`
- **THEN** next version SHALL be `0.2.0`

#### Scenario: Stable bump from prerelease version

- **WHEN** current version is `0.2.0-next.3` and bump type is `patch`
- **THEN** next version SHALL be `0.2.0` (strip prerelease, same as graduate)

#### Scenario: Prerelease bump from stable version

- **WHEN** current version is `0.1.1` and bump type is `preminor`
- **THEN** next version SHALL be `0.2.0-next.0`

#### Scenario: Prerelease increment

- **WHEN** current version is `0.2.0-next.0` and bump type is `prerelease`
- **THEN** next version SHALL be `0.2.0-next.1`, preserving the existing channel identifier

#### Scenario: Graduate strips prerelease

- **WHEN** current version is `0.2.0-next.5` and bump type is `graduate`
- **THEN** next version SHALL be `0.2.0`

#### Scenario: Graduate rejects stable version

- **WHEN** current version is `0.2.0` (no prerelease) and bump type is `graduate`
- **THEN** the script SHALL exit with an error

### Requirement: Version derived from git tags

The current version SHALL be parsed from the latest valid semver git tag, not from any package.json file.

#### Scenario: Malformed tags filtered

- **WHEN** tags include `v0.1.0-next/19` (slash) or `v0.1.0-next.v7` (extra `v` prefix)
- **THEN** those tags SHALL be excluded — only tags matching `v<major>.<minor>.<patch>(-<channel>.<number>)?` are valid

#### Scenario: No valid tags

- **WHEN** no valid semver tags exist
- **THEN** the script SHALL start from version `0.0.0`

### Requirement: Branch and cleanliness guards

The release script SHALL only run on the `main` branch with a clean working tree.

#### Scenario: Wrong branch

- **WHEN** the script is run on a branch other than `main`
- **THEN** it SHALL exit with an error naming the current branch

#### Scenario: Dirty working tree

- **WHEN** the script is run with uncommitted changes
- **THEN** it SHALL exit with an error

### Requirement: Commit, tag, and push

The release script SHALL create a version commit, a git tag, and push both to the remote.

#### Scenario: Release artifacts

- **WHEN** a release completes
- **THEN** a commit with message `release: v<version>` SHALL exist, a tag `v<version>` SHALL point to it, and both SHALL be pushed to origin

### Requirement: Dry-run mode

The release script SHALL support a `--dry-run` flag that previews the version bump without modifying any files or git state.

#### Scenario: Dry-run output

- **WHEN** `bun release patch --dry-run` is run
- **THEN** the script SHALL print the current and next version and exit without changes

### Requirement: Prerelease channel override

The release script SHALL support a `--channel` flag to override the default prerelease identifier (`next`).

#### Scenario: Custom channel

- **WHEN** `bun release premajor --channel beta` is run and current version is `0.1.0`
- **THEN** next version SHALL be `1.0.0-beta.0`

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
