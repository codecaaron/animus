# dual-engine-build

## ADDED Requirements

### Requirement: Release builds produce both engine binaries
The release pipeline SHALL build and package the v1 and v2 NAPI binaries for every supported target; a target missing either binary SHALL fail the release job rather than publish a partial matrix.

#### Scenario: CI release matrix includes v2
- **WHEN** the release workflow runs for a supported target
- **THEN** both `animus-extract.<platform>.node` and the v2 crate's binary SHALL be produced and included in the package payload
