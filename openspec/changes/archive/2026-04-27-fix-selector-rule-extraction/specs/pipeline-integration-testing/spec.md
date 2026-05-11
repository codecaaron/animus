## ADDED Requirements

### Requirement: Integration pipeline invokes production NAPI signature
The shared `runPipeline` helper in `_integration/__tests__/run-pipeline.ts` SHALL invoke `analyzeProject` with the full production signature used by the vite-plugin adapter, including `selectorAliasesJson` and `selectorOrderJson` derived from the test-system's `toConfig()` output. All integration tests that use `runPipeline` SHALL exercise the same selector-alias code path as the production plugin — no selector-alias-less integration path SHALL exist. This closes the coverage gap that allowed selector-alias-related regressions to ship without integration-tier detection.

#### Scenario: runPipeline passes selector aliases
- **WHEN** an integration test calls `runPipeline(entries)` with the standard test-system fixture
- **THEN** the NAPI call SHALL receive non-null `selectorAliasesJson` and `selectorOrderJson` sourced from `config.selectorAliases` and `config.selectorOrder`

#### Scenario: runPipeline matches vite-plugin argument arity
- **WHEN** the vite-plugin's `runAnalysis` invokes `analyzeProject` with N arguments
- **THEN** `runPipeline` SHALL invoke `analyzeProject` with the same N arguments in the same order — placeholder nulls are permitted for arguments with no integration-test-side analog (e.g. `pathAliasesJson`), but every argument slot SHALL be passed

#### Scenario: Existing integration tests pass under extended signature
- **WHEN** the existing integration test suite (`extraction.test.ts`, `serialization.test.ts`, `composition.test.ts`, `post-processing.test.ts`, `manifest-shape.test.ts`, `cascade-round-trip.test.ts`, keyframes tests) is re-run after extending `runPipeline`
- **THEN** every test SHALL pass without modification — the extension SHALL be additive, not behavior-changing, for fixtures that do not exercise selector aliases

### Requirement: Selector-rule fixture matrix registered
The integration test suite SHALL maintain a permanent selector-rule authoring fixture matrix at `_integration/fixtures/components/selector-rules/` covering the authoring cross-product that previously exposed regressions: raw-selector + alias mixes, token references inside shorthand values, compound aliases (e.g. `_selected`), `createElement(bareIdent, ...)` usage patterns, unresolvable tokens (characterization), and full chains (`.styles+_hover+_focusVisible+.variant+.states`). The matrix SHALL serve as regression acceptance criteria. Current-broken behaviors SHALL be expressed as sealed tests paired with skipped acceptance tests, so fixing the underlying bug requires a coordinated edit that prevents silent behavior change.

#### Scenario: Selector-rules fixture directory discoverable
- **WHEN** an integration test requires a selector-rule fixture
- **THEN** it SHALL be loadable via `readFixtureFile(join(__dirname, '..', 'fixtures', 'components', 'selector-rules'), filename)`

#### Scenario: Top-level fixture walk does not include the subdirectory
- **WHEN** a multi-file test calls `readFixtureFiles(COMPONENTS)` on the top-level `components/` directory
- **THEN** the walk SHALL NOT recurse into `selector-rules/` — selector-rule fixtures SHALL NOT leak into unrelated multi-file test scope

#### Scenario: Bug seal test locks current broken behavior
- **WHEN** a bug's acceptance test is marked `test.skip('[Bug N] ...')` with the expected-post-fix assertion, paired with a `test('[Bug N seal — current broken behavior]', ...)` that passes today by asserting the broken behavior
- **THEN** fixing the underlying bug SHALL cause the seal test to fail — requiring a coordinated edit to delete the seal and unskip the acceptance test, preventing silent regression drift
