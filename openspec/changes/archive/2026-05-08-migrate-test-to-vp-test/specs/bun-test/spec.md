## MODIFIED Requirements

### Requirement: Bun native test runner

Tests SHALL run via the test-runner binding designated by `orchestration-architecture`. The current binding is `vp test` (Vitest 4.x under the hood, dispatched via the `vp` orchestrator binary as `bunx vp test run`). The previous binding was `bun test`. No Jest, babel-jest, or jest-environment-jsdom dependencies SHALL be required under any binding.

#### Scenario: Run all tests from root

- **WHEN** a developer runs the test-runner binding at the repository root (currently `bunx vp test run`)
- **THEN** all test files across packages are discovered and executed

#### Scenario: Run package-specific tests

- **WHEN** a developer runs the test-runner binding scoped to a package directory (currently `bunx vp test run packages/system/__tests__`)
- **THEN** only tests in that package execute

### Requirement: Test file compatibility

Existing test files SHALL work with the test-runner binding with minimal changes. `describe`, `it`, `expect` APIs are compatible across Jest, bun:test, and Vitest. Import adjustments (e.g., `import { describe, it, expect } from 'vitest'`) SHALL be applied where needed. Snapshot assertions SHALL use `toMatchInlineSnapshot()` rather than file-based `toMatchSnapshot()`.

#### Scenario: Core unit tests pass

- **WHEN** running `bunx vp test run packages/system/__tests__`
- **THEN** all existing unit tests pass (with import adjustments only, no logic changes)

#### Scenario: Inline snapshots preferred over file-based

- **WHEN** a test requires snapshot-based assertion
- **THEN** it SHALL use `toMatchInlineSnapshot()` with the expected output co-located in the test file
- **AND** it SHALL NOT use `toMatchSnapshot()` with a separate `__snapshots__/` file

### Requirement: DOM test environment

Tests requiring DOM APIs SHALL use happy-dom rather than jsdom. Under the current binding (`vp test`), happy-dom is configured via the `test.environment` field in `vite.config.ts` and SHALL be installed as an explicit devDependency.

#### Scenario: DOM environment available

- **WHEN** a test file requires DOM APIs (document, window)
- **THEN** happy-dom provides the DOM environment as configured by `test.environment` in `vite.config.ts`

### Requirement: Binding to orchestration-architecture

The test-runner contract is owned by the `orchestration-architecture` capability. The current binding for the contract is `vp test` (Vitest 4.x under the hood, dispatched via the `vp` orchestrator binary as `bunx vp test run`). The previous binding was `bun test` and was replaced by the `migrate-test-to-vp-test` cutover follow-on. A future rebind to a different test runner SHALL preserve every requirement in this spec that is not explicitly modified by the rebind change.

The `vp test` invocation, file-discovery patterns (Vitest defaults: `**/*.{test,spec}.{ts,tsx}`), and DOM-environment defaults (happy-dom configured via `test.environment` in `vite.config.ts`) documented above describe the CURRENT binding. A future rebind MAY update these to the rebound runner's equivalents (alternative config surface, alternative DOM environment).

#### Scenario: Test contracts survive runner rebind

- **WHEN** a cutover follow-on rebinds the test runner
- **THEN** the requirements in this spec that describe SEMANTICS (e.g., snapshot inlining, parameterized fixtures, DOM availability) continue to hold under the new runner
- **AND** only the invocation-surface requirements are updated by the rebind
