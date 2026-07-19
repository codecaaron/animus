## ADDED Requirements

### Requirement: Runtime-observed engine receipts

Every consumer lane receipt SHALL obtain `engineLoaded` from a marker emitted by the engine module path exercised during that build.

#### Scenario: Configured and loaded engines differ

- **WHEN** an adapter is configured for one engine but loads the other engine module path
- **THEN** the emitted marker and receipt identify the loaded engine
- **AND** the lane fails its configured-versus-observed consistency check

#### Scenario: Build emits no engine marker

- **WHEN** a consumer build completes without an observed-engine marker
- **THEN** its assertion tier exits non-zero and does not emit an engine receipt

#### Scenario: V1 rollback lane runs

- **WHEN** the standing Vite or Next rollback verification configures v1
- **THEN** the build marker and receipt report v1 and the output assertions pass

