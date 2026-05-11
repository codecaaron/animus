## MODIFIED Requirements

### Requirement: Convergence requires shared fixtures
The convergence testing philosophy SHALL require that unit and integration tiers share the SAME theme and system fixtures. Different fixtures across tiers undermines the convergence axiom by creating divergent coverage surfaces.

#### Scenario: Both tiers use same theme
- **WHEN** canary tests and integration tests are run
- **THEN** both SHALL use the same `tokens.serialize()` output derived from the same `createTheme()` definition
- **AND** both SHALL use the same `ds.serialize()` output derived from the same `createSystem()` definition

### Requirement: Showcase serves as verified build proof
The showcase build SHALL function as a verified integration proof — not just a build that succeeds or fails, but a build whose output is automatically checked for extraction correctness.

#### Scenario: test:showcase includes output verification
- **WHEN** `bun run test:showcase` completes
- **THEN** it SHALL have run both the Vite build AND post-build assertion checks
- **AND** a failure in output assertions SHALL cause the script to exit non-zero
