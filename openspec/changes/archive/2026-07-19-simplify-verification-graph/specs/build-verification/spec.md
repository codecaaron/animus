## MODIFIED Requirements

### Requirement: Showcase as verification gate

Root `verify:full` SHALL reach the showcase package-owned `verify` claim as an extraction-pipeline integration gate. Focused showcase verification SHALL be addressed as `vp run @animus-ui/showcase#verify`; root `verify` SHALL remain free of application builds.

#### Scenario: Complete verification includes showcase

- **WHEN** a developer runs `vp run verify:full`
- **THEN** the showcase production build and output assertions execute through the showcase owner claim

#### Scenario: Focused showcase verification

- **WHEN** a developer runs `vp run @animus-ui/showcase#verify`
- **THEN** only the showcase consumer claim executes

#### Scenario: Fast verification stays build-free

- **WHEN** a developer runs `vp run verify`
- **THEN** the showcase application is not built

### Requirement: Verification commands use derived build ordering

Root complete verification SHALL materialize v1 native output, v2 native output, and TypeScript package dists in explicit dependency-safe order before selecting consumer owner claims. Owner preflights SHALL derive their transitive dist-bearing workspace dependencies from manifests and SHALL not maintain owner-specific dependency lists.

#### Scenario: Root complete build order

- **WHEN** `vp run verify:full` begins from a checkout with no built artifacts
- **THEN** both native engines and TypeScript dists are produced before consumer owner claims execute

#### Scenario: Focused owner checks derived prerequisites

- **WHEN** a package-owned consumer claim is invoked directly
- **THEN** its manifest-derived prerequisite closure is checked without silently building upstream artifacts
