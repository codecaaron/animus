# dual-engine-build Specification

## Purpose
TBD - created by archiving change extract-v2-spine. Update Purpose after archive.
## Requirements
### Requirement: Engine selection option

Extraction plugins SHALL accept an engine option with values v1 and v2, defaulting to v1 when unset, and the selected engine SHALL perform all extraction for that build.

#### Scenario: Default engine is v1

- WHEN a consumer configures the plugin without an engine option
- THEN extraction behavior is identical to the pre-change plugin

#### Scenario: Explicit v2 selection

- WHEN a consumer sets the engine option to v2
- THEN the v2 engine performs extraction for the build and the build completes without additional configuration or build steps

### Requirement: Consumer invariance under default engine

With the engine option unset, consumer-visible build outputs SHALL be identical to builds performed before this capability existed.

#### Scenario: Fixture builds unchanged

- WHEN the consumer fixture applications build with no engine option set
- THEN their emitted CSS and transformed code are identical to pre-change builds

### Requirement: Single-workspace availability of both engines

A standard workspace build SHALL produce both engines such that switching the engine option requires no rebuild commands beyond the documented standard build.

#### Scenario: Flip without extra steps

- WHEN a consumer changes only the engine option and re-runs a standard build
- THEN extraction runs on the newly selected engine

### Requirement: Release builds produce both engine binaries
The release pipeline SHALL build and package the v1 and v2 NAPI binaries for every supported target; a target missing either binary SHALL fail the release job rather than publish a partial matrix.

#### Scenario: CI release matrix includes v2
- **WHEN** the release workflow runs for a supported target
- **THEN** both `animus-extract.<platform>.node` and the v2 crate's binary SHALL be produced and included in the package payload

### Requirement: Engine identity in verification receipts

While two extractor engines coexist, every consumer-facing verification lane SHALL emit a machine-readable receipt recording: the lane name, host framework and version, execution mode, engine loaded, the default engine for that consumer, whether an engine override was applied, and the package form consumed (`workspace` or `packed`).

#### Scenario: Consumer lane completes

- **WHEN** `verify:next`, `verify:vite`, an assert tier, or `verify:packed` completes
- **THEN** a receipt exists containing lane, host, host version, mode, engine loaded, default engine, override flag, and package form

#### Scenario: Default engine flips for a consumer

- **WHEN** a consumer's default engine changes between two runs of the same lane
- **THEN** the two receipts differ in their recorded default engine, making the flip observable without reading lane logs

### Requirement: Engine execution scope across lanes

Consumer fixture lanes SHALL exercise each consumer's intended default engine; the packed consumer lane SHALL prove both engines load; semantic equivalence between engines SHALL remain the responsibility of the parity tier. No lane is required to execute every host under both engines.

#### Scenario: Consumer fixture lane runs

- **WHEN** a consumer fixture lane executes
- **THEN** extraction runs under that consumer's default engine and the receipt records it

#### Scenario: Cross-engine semantic question arises

- **WHEN** output equivalence between engines is in question for a fixture input
- **THEN** the parity tier is the lane that answers it, over the shared fixture corpus
