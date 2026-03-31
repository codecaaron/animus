## ADDED Requirements

### Requirement: Behavioral taxonomy defines 15 system behaviors
The test suite SHALL recognize 15 distinct system behaviors as the organizing taxonomy: chain recognition, style evaluation, theme resolution, CSS generation, transform emission, import resolution, chain merging, JSX scanning, reconciliation, post-processing, serialization, composition, runtime resolution, type contracts, artifact integrity.

#### Scenario: Every behavior maps to a primary test tier
- **WHEN** the behavioral taxonomy is consulted
- **THEN** each of the 15 behaviors SHALL have exactly one designated primary test tier (Rust unit, JS unit, canary, integration, type, or post-build)
- **AND** each behavior MAY have one or more secondary tiers

### Requirement: Canary describe blocks use behavioral names
Canary test describe blocks SHALL be named by the extraction behavior they verify, not by the component fixture they exercise. Component names MAY appear in individual test names but SHALL NOT be the primary grouping.

#### Scenario: Behavioral describe structure
- **WHEN** canary.test.ts is opened
- **THEN** top-level describe blocks SHALL use behavior names such as "base style extraction", "variant resolution", "responsive generation", "compound variants", "state extraction", "transform placeholders", "token alias resolution", "extension chains", "reconciliation", "system props", "custom props", "manifest and transformation"
- **AND** individual tests within each block MAY reference the component fixture used (e.g., "button fixture produces size variants")

#### Scenario: No component-oriented top-level describes
- **WHEN** searching canary.test.ts for describe block names
- **THEN** no top-level describe block SHALL be named "Canary: <ComponentName> extraction"

### Requirement: Integration test files named by behavior
Integration test files in `packages/_integration/__tests__/` SHALL be named for the behavior they test, not the pipeline mechanism they exercise.

#### Scenario: Serialization behavior file
- **WHEN** tests verify `serialize()` output shape and NAPI round-trip
- **THEN** those tests SHALL live in `serialization.test.ts`

#### Scenario: Extraction behavior file
- **WHEN** tests verify full pipeline extraction output (NAPI → post-processing → final CSS)
- **THEN** those tests SHALL live in `extraction.test.ts`

#### Scenario: Composition behavior file
- **WHEN** tests verify `compose()` through the extraction pipeline
- **THEN** those tests SHALL live in `composition.test.ts`

### Requirement: Parametrized tests for repetitive assertions
Where multiple inputs test the same behavior with different expected outputs, tests SHALL use `test.each()` parametrization instead of repeating the assertion pattern.

#### Scenario: Variant option resolution uses test.each
- **WHEN** testing that variant options (e.g., size:small, size:medium, size:large) each resolve to expected CSS values
- **THEN** a single `test.each()` block SHALL define the input-output pairs
- **AND** each pair SHALL be a separate test invocation with a descriptive name template

#### Scenario: Post-processing unit fallback uses test.each
- **WHEN** testing that `applyUnitFallback()` handles multiple property types (length, unitless, zero)
- **THEN** a single `test.each()` block SHALL cover the property × value matrix

### Requirement: Token invariant guard on integration tests
Every integration test that produces CSS output through the pipeline SHALL include an assertion that no raw unresolved token names appear as CSS property values.

#### Scenario: Extraction test guards against raw tokens
- **WHEN** an integration test calls `runPipeline()` and receives CSS output
- **THEN** the test SHALL assert that CSS does not contain patterns matching known theme token names as bare property values (e.g., `background-color: primary;` or `color: danger;`)

#### Scenario: Guard uses theme-derived token list
- **WHEN** the token invariant guard is applied
- **THEN** the list of guarded token names SHALL derive from the shared theme fixture's scale names (colors, color modes), not from a hand-maintained list

### Requirement: TESTING.md behavioral manifest
A `TESTING.md` file SHALL exist at the repository root mapping every system behavior to its test locations, tiers, and assertion patterns.

#### Scenario: Manifest maps all 15 behaviors
- **WHEN** TESTING.md is consulted
- **THEN** it SHALL contain an entry for each of the 15 system behaviors
- **AND** each entry SHALL include: behavior name, primary test tier, primary file location, secondary tier(s) if any, assertion pattern used

#### Scenario: Manifest includes tier summary
- **WHEN** TESTING.md is consulted
- **THEN** it SHALL include a summary table of all test tiers with: tier name, run command, file count, purpose description

#### Scenario: Manifest includes test counts
- **WHEN** TESTING.md is consulted
- **THEN** it SHALL include current test counts per tier (Rust unit, JS unit, canary, integration, type, post-build)
