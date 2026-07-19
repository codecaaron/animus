## ADDED Requirements

### Requirement: Content-addressed snapshots

The ledger SHALL persist one normalized universe snapshot per recorded commit, addressed by content and stamped with engine identity, contract schema version, and analysis mode.

#### Scenario: Deterministic addressing

- **WHEN** the same workspace tree is analyzed twice under the same engine and schema version
- **THEN** both snapshots resolve to the same content address

#### Scenario: Stamp inspection

- **WHEN** a consumer reads any snapshot
- **THEN** the engine identity, schema version, and mode are recoverable from the snapshot alone

### Requirement: Comparison without re-analysis

Two ledger snapshots SHALL be comparable into a semantic universe diff without re-running analysis on either commit.

#### Scenario: Historical comparison

- **WHEN** snapshots exist for two commits
- **THEN** their universe diff is computed from the snapshots alone, with no checkout or analysis of either commit

### Requirement: Cross-stamp comparison honesty

A comparison across snapshots with differing engine identity or schema version SHALL be reported as bounded by that difference, never as a clean semantic diff.

#### Scenario: Engine changed between commits

- **WHEN** two snapshots carry different engine identities
- **THEN** the comparison result names the stamp difference and marks affected conclusions as `conditional`
