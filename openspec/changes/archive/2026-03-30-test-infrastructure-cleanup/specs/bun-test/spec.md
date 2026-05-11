## MODIFIED Requirements

### Requirement: Test file compatibility
Existing test files SHALL work with bun:test with minimal changes. `describe`, `it`, `expect` APIs are compatible between Jest and bun:test. Import adjustments (e.g., `import { describe, it, expect } from 'bun:test'`) SHALL be applied where needed. Snapshot assertions SHALL use `toMatchInlineSnapshot()` rather than file-based `toMatchSnapshot()`.

#### Scenario: Core unit tests pass
- **WHEN** running `bun test` against `packages/system/__tests__/`
- **THEN** all existing unit tests pass (with import adjustments only, no logic changes)

#### Scenario: Inline snapshots preferred over file-based
- **WHEN** a test requires snapshot-based assertion
- **THEN** it SHALL use `toMatchInlineSnapshot()` with the expected output co-located in the test file
- **AND** it SHALL NOT use `toMatchSnapshot()` with a separate `__snapshots__/` file

## ADDED Requirements

### Requirement: Parameterized fixture testing
Extract canary tests MAY use `test.each` or `describe.each` for parameterized testing across fixture files, reducing boilerplate while maintaining per-fixture diagnostic clarity.

#### Scenario: Parameterized extraction tests
- **WHEN** multiple fixture files require the same extraction assertion pattern
- **THEN** `test.each` or `describe.each` SHALL be used with the fixture name visible in test output
- **AND** each fixture SHALL produce its own pass/fail result for diagnostic clarity
