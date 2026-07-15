# verification-tier-policy

## ADDED Requirements

### Requirement: Packed Consumer Tier

The repository SHALL provide `vp run verify:packed` as an atomic tier that packs the publishable packages, lints the tarballs, installs them into an isolated non-workspace consumer, and runs that consumer's loading, type-check, build, and assertion checks. Its upstream preconditions are fresh v1 and v2 NAPI binaries, fresh `dist/` for all five publishable packages, and fresh `_assertions/dist/`; a missing precondition SHALL fail loud with an `ERROR: X missing. Run: Y` message and SHALL NOT trigger a rebuild.

#### Scenario: Missing upstream dist

- **WHEN** `vp run verify:packed` runs while a publishable package's `dist/` is absent or stale
- **THEN** the tier exits non-zero with an `ERROR: X missing. Run: Y` message naming the remediation command
- **AND** no upstream build is invoked

#### Scenario: Fresh upstream artifacts

- **WHEN** `vp run verify:packed` runs with all preconditions satisfied
- **THEN** the pack, lint, install, load, type-check, build, and assertion stages execute in order

### Requirement: Packed Tier Composite Membership

The `verify:full` and `verify:ci` composite orchestrators SHALL include the packed consumer lane.

#### Scenario: Full local pipeline includes the packed lane

- **WHEN** a developer runs `vp run verify:full`
- **THEN** `verify:packed` executes after its upstream build tiers

#### Scenario: CI simulation includes the packed lane

- **WHEN** a developer runs `vp run verify:ci`
- **THEN** `verify:packed` executes in a position mirroring its CI job

### Requirement: Packed Tier Change-Type Coverage

The root `CLAUDE.md` Change-Type Map SHALL contain rows mapping the packed consumer fixture (`e2e/packed-app/**`), the packed-lane scripts, and publishable-package manifest edits (`packages/*/package.json` dependency or peer-range changes) to a tier set that includes `verify:packed`.

#### Scenario: Packed consumer fixture edited

- **WHEN** a contributor consults the Change-Type Map after editing `e2e/packed-app/**`
- **THEN** the map directs them to run `verify:packed`

#### Scenario: Plugin peer range edited

- **WHEN** a contributor consults the Change-Type Map after editing a publishable package's peer ranges
- **THEN** the map directs them to a tier set that includes `verify:packed`
