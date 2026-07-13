# extraction-parity-harness

## ADDED Requirements

### Requirement: Divergence is licensed by registration
Engine divergence SHALL be permitted only through an active register entry naming the unit, artifact class, and category; comparison logic SHALL NOT be modified to absorb a divergence.

#### Scenario: Shed lands with its register entry
- **WHEN** a v2 fix intentionally diverges from v1 output on a corpus unit
- **THEN** the differential run SHALL report the divergence as registered (0 unregistered) without any change to comparison code

### Requirement: Oracle inversion to committed baselines
When v1 leaves the oracle set, the harness SHALL compare v2 against committed baseline snapshots with an explicit refresh protocol; baseline refresh SHALL require a green run and a journal-recorded intent.

#### Scenario: Baseline refresh after an intentional change
- **WHEN** an intentional output change lands after oracle inversion
- **THEN** the stale baseline SHALL fail the gate until refreshed by the documented protocol, and a red run SHALL NOT overwrite any baseline
