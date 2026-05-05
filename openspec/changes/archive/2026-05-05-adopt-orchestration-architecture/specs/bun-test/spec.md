## ADDED Requirements

### Requirement: Binding to orchestration-architecture

The test-runner contract is owned by the `orchestration-architecture` capability. The current binding for the contract is `bun test`. A future rebind to a different test runner (e.g., Vitest via `vp test` per the `migrate-test-to-vp-test` follow-on policy change) SHALL preserve every requirement in this spec that is not explicitly modified by the rebind change.

The `bun test` invocation, file-discovery patterns, and DOM-environment defaults documented below describe the CURRENT binding. The rebind follow-on MAY update these to the rebound runner's equivalents (e.g., Vitest config files, alternative DOM environment).

#### Scenario: Test contracts survive runner rebind

- **WHEN** a cutover follow-on rebinds the test runner
- **THEN** the requirements in this spec that describe SEMANTICS (e.g., snapshot inlining, parameterized fixtures, DOM availability) continue to hold under the new runner
- **AND** only the invocation-surface requirements are updated by the rebind

## MODIFIED Requirements

### Requirement: Bun native test runner

Tests SHALL run via the test-runner binding designated by `orchestration-architecture`. The current binding is `bun test`. No Jest, babel-jest, or jest-environment-jsdom dependencies SHALL be required under any binding.

#### Scenario: Run all tests from root

- **WHEN** a developer runs the test-runner binding at the repository root (currently `bun test`)
- **THEN** all test files across packages are discovered and executed

#### Scenario: Run package-specific tests

- **WHEN** a developer runs the test-runner binding from within `packages/core` (currently `bun test`)
- **THEN** only tests in that package execute
