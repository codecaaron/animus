## MODIFIED Requirements

### Requirement: Shared system+theme fixture built from real builder API
The test infrastructure SHALL have a SINGLE shared system+theme definition used by both the extract canary tests and the integration test workspace. The definition SHALL live in `packages/extract/tests/test-system.ts` and be importable by `packages/_integration/`.

#### Scenario: Integration workspace imports shared fixture
- **WHEN** integration tests need a system+theme fixture
- **THEN** they SHALL import `ds` and `tokens` from the canary test-system (directly or via re-export)
- **AND** they SHALL NOT maintain a separate system/theme definition

#### Scenario: Theme covers all test tier needs
- **WHEN** the shared theme is built
- **THEN** it SHALL include breakpoints matching the canary tier (xs, sm, md, lg, xl)
- **AND** it SHALL include contextual vars
- **AND** it SHALL include color modes
- **AND** it SHALL include all scales needed by both canary and integration fixtures
