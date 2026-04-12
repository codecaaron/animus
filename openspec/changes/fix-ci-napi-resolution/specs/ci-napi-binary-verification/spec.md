## ADDED Requirements

### Requirement: NAPI binary verification step in verify job
The `verify` CI job SHALL include a verification step after binary download and `bun install` that confirms the NAPI binary is present and loadable. The step MUST print the binary file listing and exported function names.

#### Scenario: Binary present and loadable
- **WHEN** the verify job downloads the NAPI binary and runs `bun install`
- **THEN** the verification step lists the `.node` file with size and prints the NAPI export keys (analyzeProject, clearAnalysisCache, extract, loadSystemModule, transformFile)

#### Scenario: Binary missing or corrupt
- **WHEN** the `.node` file is missing or fails to load
- **THEN** the verification step fails with a clear error message before any test execution
