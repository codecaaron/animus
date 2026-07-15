## MODIFIED Requirements

### Requirement: Integration pipeline invokes production NAPI signature

The shared `runPipeline` helper in `_integration/__tests__/run-pipeline.ts` SHALL invoke `analyzeProject` with the full production signature used by the vite-plugin adapter, including `selectorAliasesJson` derived from the test-system's `toConfig()` output. The retained optional selector-order argument slot SHALL receive a placeholder after `selectorOrder` leaves the serialized config. All integration tests that use `runPipeline` SHALL exercise the same selector-alias code path as the production plugin — no selector-alias-less integration path SHALL exist. This closes the coverage gap that allowed selector-alias-related regressions to ship without integration-tier detection.

#### Scenario: runPipeline passes selector aliases

- **WHEN** an integration test calls `runPipeline(entries)` with the standard test-system fixture
- **THEN** the NAPI call SHALL receive non-null `selectorAliasesJson` sourced from `config.selectorAliases`
- **AND** the retained optional selector-order argument slot SHALL receive `null`

#### Scenario: runPipeline matches vite-plugin argument arity

- **WHEN** the vite-plugin's `runAnalysis` invokes `analyzeProject` with N arguments
- **THEN** `runPipeline` SHALL invoke `analyzeProject` with the same N arguments in the same order — placeholder nulls are permitted for arguments with no integration-test-side analog (e.g. `selectorOrderJson` and `pathAliasesJson`), but every argument slot SHALL be passed

#### Scenario: Existing integration tests pass under extended signature

- **WHEN** the existing integration test suite (`extraction.test.ts`, `serialization.test.ts`, `composition.test.ts`, `post-processing.test.ts`, `manifest-shape.test.ts`, `cascade-round-trip.test.ts`, keyframes tests) is re-run after updating `runPipeline`
- **THEN** every test SHALL pass without behavior changes for fixtures that do not exercise selector aliases
