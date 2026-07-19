## MODIFIED Requirements

### Requirement: Assertions replace shell grep

Build-output assertions SHALL remain implemented in TypeScript and shared assertion utilities rather than shell grep pipelines. Consumer packages SHALL invoke their TypeScript assertions through the parameterized `scripts/verify/assert-consumer.sh` precondition helper; per-target assertion wrapper scripts SHALL not be required.

#### Scenario: Shared owner helper replaces per-target wrappers

- **WHEN** a package-owned `verify:assert` diagnostic runs
- **THEN** the shared helper validates output and assertion-package prerequisites
- **AND** the owning TypeScript assertion implementation executes
- **AND** no per-target `assert-<consumer>.sh` wrapper is involved
