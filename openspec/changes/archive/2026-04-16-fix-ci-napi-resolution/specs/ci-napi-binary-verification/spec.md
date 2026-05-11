## ADDED Requirements

### Requirement: NAPI binary verification steps in verify job
The `verify` CI job SHALL include two verification steps after binary download and `bun install` that confirm the NAPI binary is present and loadable from both the repo root and the `_integration` test context. The steps MUST run before any build or test execution.

#### Scenario: Binary present and loadable from repo root
- **WHEN** the verify job downloads the NAPI binary and runs `bun install`
- **THEN** the "Verify NAPI binary (repo root context)" step lists the `.node` file with size and prints the NAPI export keys via `require('./packages/extract/index.js')`

#### Scenario: Binary present and loadable from _integration context
- **WHEN** the verify job downloads the NAPI binary and runs `bun install`
- **THEN** the "Verify NAPI binary (_integration context)" step confirms `analyzeProject` is a function when loaded via `require('../../extract/index.js')` from the `packages/_integration/__tests__` working directory

#### Scenario: Binary missing or corrupt
- **WHEN** the `.node` file is missing or fails to load
- **THEN** the verification step fails with a clear error message before any test execution
