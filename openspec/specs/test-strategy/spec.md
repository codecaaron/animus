## ADDED Requirements

### Requirement: Three-tier testing model
The test infrastructure SHALL follow a three-tier model: unit tests (bottom-up), type tests (compile-time), and integration/canary tests (top-down). Each tier SHALL use distinct assertion tools appropriate to its purpose.

#### Scenario: Unit tests use explicit assertions
- **WHEN** a test validates individual function behavior (e.g., createClassResolver, variant resolution, theme builder)
- **THEN** the test SHALL use explicit matchers (`.toBe()`, `.toEqual()`, `.toContain()`) rather than snapshots
- **AND** the test SHALL not depend on other test tiers passing

#### Scenario: Type tests use compile-time assertions
- **WHEN** a test validates type-level behavior (API surface narrowness, generic inference)
- **THEN** the test SHALL use `tsc --noEmit` with `Assert<>`, `IsExact<>`, and `@ts-expect-error` patterns
- **AND** the test SHALL live in `.test-d.tsx` files under the system package

#### Scenario: Integration tests use inline snapshots plus explicit assertions
- **WHEN** a test validates the full extraction pipeline (source file → NAPI → CSS + transformed JS)
- **THEN** the test SHALL use `toMatchInlineSnapshot()` for structural output (layer ordering, class patterns, @media nesting)
- **AND** the test SHALL use explicit matchers for semantic correctness (specific values, specific layers, specific class names)

### Requirement: Snapshot policy — inline only
All snapshot-based assertions SHALL use `toMatchInlineSnapshot()`. File-based snapshot directories (`__snapshots__/`) SHALL NOT exist in the repository for in-scope packages (system, extract, vite-plugin).

#### Scenario: No file-based snapshots in system package
- **WHEN** searching `packages/system/__tests__/__snapshots__/`
- **THEN** the directory SHALL NOT exist

#### Scenario: No file-based snapshots in extract package
- **WHEN** searching `packages/extract/tests/__snapshots__/`
- **THEN** the directory SHALL NOT exist

#### Scenario: Inline snapshot size limit
- **WHEN** an inline snapshot is written in a test file
- **THEN** the snapshot content SHALL be focused on a single structural concern (e.g., one layer's CSS, one component's class pattern)
- **AND** the snapshot SHOULD remain under approximately 30 lines

### Requirement: Snapshots for structure, assertions for semantics
Snapshots SHALL guard structural output stability (did the shape change?). Explicit assertions SHALL guard semantic correctness (is the right value in the right place?).

#### Scenario: CSS layer ordering verified by snapshot
- **WHEN** testing that extraction produces correctly layered CSS
- **THEN** the layer ordering (`@layer global, base, variants, compounds, states, system, custom`) SHALL be verified via inline snapshot of the full CSS structure

#### Scenario: Specific CSS values verified by explicit assertion
- **WHEN** testing that a specific style value (e.g., `display: inline-flex`) appears in the correct layer
- **THEN** the assertion SHALL use `.toContain()` or `.toBe()`, not a snapshot

### Requirement: Convergence testing philosophy
The unit tier and integration tier SHALL together cover the full behavior space through convergence. The "middle" (wiring between individual functions and the full pipeline) SHALL be validated implicitly by both tiers passing, without requiring explicit mocks or middleware tests.

#### Scenario: No mock-based middleware tests
- **WHEN** the test suite is reviewed for mock usage
- **THEN** no test SHALL mock internal functions to test wiring between pipeline stages
- **AND** pipeline correctness SHALL be validated by unit tests passing (bottom) plus integration tests passing (top)

#### Scenario: Failure cascading provides diagnostic trace
- **WHEN** a code change causes a pipeline regression
- **THEN** unit test failures SHALL narrow the cause to specific functions
- **AND** integration test failures SHALL confirm the pipeline-level impact
- **AND** the combination of failures SHALL provide a diagnostic trace without requiring additional investigation
