## ADDED Requirements

### Requirement: Bun native test runner
Tests SHALL run via `bun test`. No Jest, babel-jest, or jest-environment-jsdom dependencies SHALL be required.

#### Scenario: Run all tests from root
- **WHEN** a developer runs `bun test` from the repository root
- **THEN** all test files across packages are discovered and executed

#### Scenario: Run package-specific tests
- **WHEN** a developer runs `bun test` from within `packages/core`
- **THEN** only tests in that package execute

### Requirement: No Jest configuration
The repository SHALL NOT contain Jest configuration files. All `jest.config.js`, `jest.config.base.js`, and `tsconfig.jest.json` files SHALL be removed.

#### Scenario: Jest config removal
- **WHEN** searching the repository for Jest configuration
- **THEN** no `jest.config.*` files exist at any level
- **THEN** no `jest`, `babel-jest`, `jest-environment-*`, or `jest-junit` entries exist in any `package.json`

### Requirement: Test file compatibility
Existing test files SHALL work with bun:test with minimal changes. `describe`, `it`, `expect` APIs are compatible between Jest and bun:test. Import adjustments (e.g., `import { describe, it, expect } from 'bun:test'`) SHALL be applied where needed.

#### Scenario: Core unit tests pass
- **WHEN** running `bun test` against `packages/core/__tests__/`
- **THEN** all existing unit tests pass (with import adjustments only, no logic changes)

### Requirement: DOM test environment
Tests requiring DOM APIs SHALL use bun:test's built-in happy-dom support rather than jsdom.

#### Scenario: DOM environment available
- **WHEN** a test file requires DOM APIs (document, window)
- **THEN** happy-dom provides the DOM environment without external dependencies
