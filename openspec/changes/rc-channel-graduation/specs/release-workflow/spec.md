## MODIFIED Requirements

### Requirement: CI publish pipeline alignment

The CI release job SHALL publish the same set of packages the release script stamps: `properties`, `system`, `extract`, `vite-plugin`, `next-plugin`. Legacy packages (`core`, `theming`) SHALL NOT appear in CI version-bump or publish loops. CI SHALL derive the npm dist-tag from the semver prerelease-identifier segment of the version — not from a substring check for a hyphen. Versions without a prerelease identifier SHALL publish to `--tag latest`.

#### Scenario: Prerelease tags publish to channel-named dist-tag

- **WHEN** CI processes a tag whose version is `1.0.0-rc.0`
- **THEN** all packages SHALL be published with `--tag rc`

#### Scenario: Dev prerelease channel unaffected

- **WHEN** CI processes a tag whose version is `0.1.0-next.62`
- **THEN** all packages SHALL be published with `--tag next`

#### Scenario: Stable tags publish to npm `latest`

- **WHEN** CI processes a tag without a prerelease identifier (e.g., `v1.0.0`)
- **THEN** all packages SHALL be published with `--tag latest`

#### Scenario: Custom prerelease channel

- **WHEN** CI processes a tag whose version is `1.1.0-beta.2`
- **THEN** all packages SHALL be published with `--tag beta`

## ADDED Requirements

### Requirement: Pre-publish local verify gate

The release script SHALL invoke `bun run verify:ci` after branch/cleanliness guards pass and before any version-bump, commit, tag, or push action. The script SHALL exit non-zero if `verify:ci` fails, leaving the working tree and git state untouched.

#### Scenario: Verify gate runs on every release

- **WHEN** `bun release patch` (or any bump type) is invoked on a clean main branch
- **THEN** `bun run verify:ci` SHALL run before any file or git state is modified
- **AND** if `verify:ci` exits non-zero, the release script SHALL exit without creating a commit, tag, or push

#### Scenario: Dry-run skips verify gate

- **WHEN** `bun release patch --dry-run` is invoked
- **THEN** `verify:ci` SHALL NOT run — the dry-run exits after printing version arithmetic without validation

### Requirement: Stale-channel guard on current version resolution

When `get_latest_tag` resolves the CURRENT version and the CURRENT version's prerelease channel differs from the requested `--channel` (or the default `next` when no flag is given), the script SHALL refuse channel-scoped prerelease bumps (`prepatch`, `preminor`, `premajor`, `prerelease`) unless the operator either (a) passes an explicit `--channel` that matches CURRENT's channel, or (b) uses a channel-agnostic bump type (`patch`, `minor`, `major`, `graduate`).

#### Scenario: Drift tag blocks unqualified prerelease bump

- **WHEN** CURRENT resolves to `0.1.1-beta.1` (from pre-existing drift tags) and `bun release prerelease` is invoked without `--channel`
- **THEN** the script SHALL exit with an error naming the channel drift: CURRENT channel is `beta`, requested default is `next`
- **AND** the error SHALL suggest either `--channel beta` (continue on the drift channel) or a channel-agnostic bump type

#### Scenario: Explicit channel match permits the bump

- **WHEN** CURRENT resolves to `0.1.1-beta.1` and `bun release prerelease --channel beta` is invoked
- **THEN** the script SHALL proceed, yielding `0.1.1-beta.2`

#### Scenario: Channel-agnostic bump bypasses the guard

- **WHEN** CURRENT resolves to `0.1.1-beta.1` and `bun release major` is invoked
- **THEN** the script SHALL proceed, yielding `1.0.0` — the guard does not fire for stable bumps

#### Scenario: Matching default channel permits the bump

- **WHEN** CURRENT resolves to `0.1.0-next.61` and `bun release prerelease` is invoked with no flag (default channel `next`)
- **THEN** the guard SHALL NOT fire — CURRENT channel `next` matches the default
- **AND** the script SHALL proceed, yielding `0.1.0-next.62`
