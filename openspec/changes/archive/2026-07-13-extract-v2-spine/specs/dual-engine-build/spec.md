# dual-engine-build

## ADDED Requirements

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
