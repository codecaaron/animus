## ADDED Requirements

### Requirement: Runbook exists as single document
The project SHALL maintain a single graduation-runbook document that prescribes the three release-channel operational flows: cutting the initial RC, iterating RC releases, and graduating to the first stable version.

#### Scenario: Runbook location
- **WHEN** a maintainer needs to execute any release-channel operation
- **THEN** a single runbook document SHALL exist at a checked-in path (e.g., `docs/release-runbook.md` or `RELEASE.md`)
- **AND** the runbook SHALL be referenced from the root `README.md` release section

#### Scenario: Runbook covers all three flows
- **WHEN** the runbook is read end-to-end
- **THEN** it SHALL describe, in order: (a) cutting the first RC from a freshly-merged main, (b) iterating a subsequent RC release, (c) graduating the latest RC to stable

### Requirement: Cut-RC flow is command-complete
The runbook's "cut initial RC" section SHALL list every command a maintainer runs, in order, with verification checkpoints between stages.

#### Scenario: Cut-RC command sequence
- **WHEN** a maintainer follows the cut-RC flow
- **THEN** the runbook SHALL prescribe: (1) ensure `main` is current, (2) run `bun run verify:ci` locally, (3) run `bun release premajor --channel rc`, (4) monitor CI publish, (5) verify npm dist-tags reflect the expected channel, (6) smoke-test an external install via `npm install @animus-ui/system@rc`

#### Scenario: Cut-RC verification checkpoints
- **WHEN** the maintainer reaches each checkpoint
- **THEN** the runbook SHALL describe the expected observable (e.g., "expect `npm view @animus-ui/system dist-tags` to show `rc: 1.0.0-rc.0`")
- **AND** the runbook SHALL describe the recovery action if the observable is not met

### Requirement: Iterate-RC flow addresses breaking changes
The runbook's "iterate RC" section SHALL describe how to introduce breaking changes between `rc.N` and `rc.N+1` without spec violations, including CHANGELOG entries for the iteration.

#### Scenario: Iterate-RC command sequence
- **WHEN** a maintainer introduces changes for a new RC iteration
- **THEN** the runbook SHALL prescribe: (1) land changes on `main` via the project's merge strategy, (2) update CHANGELOG for the pending iteration, (3) run `bun run verify:ci`, (4) run `bun release prerelease --channel rc`, (5) verify CI publishes to `--tag rc`

#### Scenario: Breaking-change documentation during RC
- **WHEN** an `rc.N → rc.N+1` iteration includes a breaking change
- **THEN** the runbook SHALL require the CHANGELOG entry to explicitly call out the break with a **BREAKING** prefix and migration guidance for anyone piloting the RC

### Requirement: Graduate flow documents stabilization commitment
The runbook's "graduate" section SHALL describe how to transition from the latest `rc.N` to the first `1.0.0` stable release, including the stabilization-window commitment that takes effect at graduation.

#### Scenario: Graduate command sequence
- **WHEN** the maintainer decides to graduate
- **THEN** the runbook SHALL prescribe: (1) final `bun run verify:ci`, (2) publish a final CHANGELOG entry for `1.0.0`, (3) run `bun release graduate`, (4) verify CI publishes to `--tag latest` (auto-reclaiming from whatever `latest` previously pointed at), (5) announce stabilization commitment

#### Scenario: Stabilization commitment is explicit
- **WHEN** the runbook's graduate section is read
- **THEN** it SHALL state the stabilization-window strictness (strict patches-only vs. loose cooling-off) and duration
- **AND** it SHALL identify what kinds of changes are admissible during the window

### Requirement: Runbook identifies rollback paths
The runbook SHALL document non-destructive rollback paths for the most common failure modes, consistent with CLAUDE.md §1 (no mutative git operations).

#### Scenario: Failed RC publish
- **WHEN** an `rc.N` publish fails CI or produces an incorrect dist-tag
- **THEN** the runbook SHALL prescribe forward-fix via `rc.N+1` rather than tag deletion or force-push
- **AND** the runbook SHALL describe how to correct a dist-tag with `npm dist-tag add` commands

#### Scenario: Accidental stable publish
- **WHEN** a non-prerelease is published before intended graduation
- **THEN** the runbook SHALL prescribe forward-fix via patch release rather than unpublish
- **AND** the runbook SHALL note that `npm unpublish` has a 72-hour window and should be avoided unless a security issue requires it
