# dual-engine-build Specification

## Purpose
TBD - created by archiving change extract-v2-spine. Update Purpose after archive.
## Requirements
### Requirement: Engine identity in verification receipts

Consumer owner claims, their package-owned assertion diagnostics, and packed verification SHALL record engine identity in their existing receipts. Renaming or relocating the command owner SHALL not weaken default/override engine evidence.

#### Scenario: Consumer lane completes

- **WHEN** a package-owned consumer `verify` claim or `verify:packed` completes
- **THEN** its receipt records the selected engine and relevant default/override identity

#### Scenario: Default engine flips for a consumer

- **WHEN** a consumer's default engine changes
- **THEN** the receipt identifies the new default distinctly from an explicit override

### Requirement: Engine execution scope across lanes

Consumer fixture lanes SHALL exercise the v2 engine; the packed consumer lane SHALL prove the v2 engine loads; semantic conformance SHALL remain the responsibility of the parity tier against its committed baselines.

#### Scenario: Consumer fixture lane runs

- WHEN a consumer fixture lane executes
- THEN extraction runs under the v2 engine and the receipt records it

#### Scenario: Cross-engine semantic question arises

- WHEN output conformance relative to the retired v1 engine is in question for a fixture input
- THEN the parity tier answers it over the shared fixture corpus and the committed baselines (no live v1 execution exists)

### Requirement: Single-engine selection

Extraction plugins SHALL accept an optional engine option whose only valid value is v2, defaulting to v2 when unset, and the v2 engine SHALL perform all extraction for every build. Configuring `engine: 'v1'` or `ANIMUS_ENGINE=v1` SHALL stop the build with an error naming the retirement change (`retire-extract-v1`) and stating that v2 is the only engine; the selection SHALL never be silently upgraded.

#### Scenario: Default engine is v2

- WHEN a consumer configures the plugin without an engine option
- THEN the v2 engine performs extraction for the build

#### Scenario: Explicit v2 selection

- WHEN a consumer sets the engine option to v2
- THEN the v2 engine performs extraction and the build completes without additional configuration or build steps

#### Scenario: Retired v1 selection fails loud

- WHEN a consumer sets the engine option to v1 or sets `ANIMUS_ENGINE=v1`
- THEN the build exits non-zero with a message naming `retire-extract-v1` and the removal remediation
- AND no extraction is attempted

### Requirement: Release builds produce the v2 engine binary

The release pipeline SHALL build and package the v2 NAPI binary for every supported target; a target missing the binary SHALL fail the release job rather than publish a partial matrix.

#### Scenario: CI release matrix includes v2

- **WHEN** the release workflow runs for a supported target
- **THEN** the v2 crate's binary SHALL be produced and included in the package payload
- **AND** no v1 binary is built, packaged, or referenced

