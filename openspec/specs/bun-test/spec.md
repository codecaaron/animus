## ADDED Requirements

### Requirement: Bun native test runner

Tests SHALL run via the test-runner binding designated by `orchestration-architecture`. The current binding is `bun test`. No Jest, babel-jest, or jest-environment-jsdom dependencies SHALL be required under any binding.

#### Scenario: Run all tests from root

- **WHEN** a developer runs the test-runner binding at the repository root (currently `bun test`)
- **THEN** all test files across packages are discovered and executed

#### Scenario: Run package-specific tests

- **WHEN** a developer runs the test-runner binding from within `packages/core` (currently `bun test`)
- **THEN** only tests in that package execute

### Requirement: No Jest configuration

The repository SHALL NOT contain Jest configuration files. All `jest.config.js`, `jest.config.base.js`, and `tsconfig.jest.json` files SHALL be removed.

#### Scenario: Jest config removal

- **WHEN** searching the repository for Jest configuration
- **THEN** no `jest.config.*` files exist at any level
- **THEN** no `jest`, `babel-jest`, `jest-environment-*`, or `jest-junit` entries exist in any `package.json`

### Requirement: Test file compatibility

Existing test files SHALL work with bun:test with minimal changes. `describe`, `it`, `expect` APIs are compatible between Jest and bun:test. Import adjustments (e.g., `import { describe, it, expect } from 'bun:test'`) SHALL be applied where needed. Snapshot assertions SHALL use `toMatchInlineSnapshot()` rather than file-based `toMatchSnapshot()`.

#### Scenario: Core unit tests pass

- **WHEN** running `bun test` against `packages/system/__tests__/`
- **THEN** all existing unit tests pass (with import adjustments only, no logic changes)

#### Scenario: Inline snapshots preferred over file-based

- **WHEN** a test requires snapshot-based assertion
- **THEN** it SHALL use `toMatchInlineSnapshot()` with the expected output co-located in the test file
- **AND** it SHALL NOT use `toMatchSnapshot()` with a separate `__snapshots__/` file

### Requirement: Parameterized fixture testing

Extract canary tests MAY use `test.each` or `describe.each` for parameterized testing across fixture files, reducing boilerplate while maintaining per-fixture diagnostic clarity.

#### Scenario: Parameterized extraction tests

- **WHEN** multiple fixture files require the same extraction assertion pattern
- **THEN** `test.each` or `describe.each` SHALL be used with the fixture name visible in test output
- **AND** each fixture SHALL produce its own pass/fail result for diagnostic clarity

### Requirement: DOM test environment

Tests requiring DOM APIs SHALL use bun:test's built-in happy-dom support rather than jsdom.

#### Scenario: DOM environment available

- **WHEN** a test file requires DOM APIs (document, window)
- **THEN** happy-dom provides the DOM environment without external dependencies

### Requirement: Binding to orchestration-architecture

The test-runner contract is owned by the `orchestration-architecture` capability. The current binding for the contract is `bun test`. A future rebind to a different test runner (e.g., Vitest via `vp test` per the `migrate-test-to-vp-test` follow-on policy change) SHALL preserve every requirement in this spec that is not explicitly modified by the rebind change.

The `bun test` invocation, file-discovery patterns, and DOM-environment defaults documented below describe the CURRENT binding. The rebind follow-on MAY update these to the rebound runner's equivalents (e.g., Vitest config files, alternative DOM environment).

#### Scenario: Test contracts survive runner rebind

- **WHEN** a cutover follow-on rebinds the test runner
- **THEN** the requirements in this spec that describe SEMANTICS (e.g., snapshot inlining, parameterized fixtures, DOM availability) continue to hold under the new runner
- **AND** only the invocation-surface requirements are updated by the rebind
