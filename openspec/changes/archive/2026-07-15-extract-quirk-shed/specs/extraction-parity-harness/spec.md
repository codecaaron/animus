# extraction-parity-harness

## ADDED Requirements

### Requirement: Registration authorizes privileged refresh
Intentional committed-baseline drift SHALL be authorized for privileged refresh only through an active register entry naming the unit, artifact class, allowed category, and exact baseline and candidate content identities; comparison logic SHALL NOT be modified to absorb drift. An active entry SHALL NOT license a live-engine differential or make an ordinary committed-baseline comparison pass.

#### Scenario: Exact registration authorizes a refresh attempt
- **WHEN** fresh v2 intentionally changes a committed artifact and an active entry matches the exact baseline and candidate identities
- **THEN** the privileged refresh MAY proceed to its remaining gates without any change to comparison code

#### Scenario: Registered drift remains stale in an ordinary baseline run
- **WHEN** candidate output differs from a committed baseline and the exact drift has an active register entry
- **THEN** ordinary verification SHALL still fail until the privileged refresh protocol succeeds

### Requirement: Oracle inversion to committed baselines
When v1 leaves the oracle set, the harness SHALL compare v2 against versioned committed production and development baseline snapshots. Ordinary verification SHALL be read-only for baseline files and compare baseline-only and candidate-only units in addition to changed artifacts. Baseline refresh SHALL be a separate explicit operation requiring a checked journal intent, exact registered drift, successful deterministic candidate runs, and valid corpus invariants in both modes before atomic replacement.

#### Scenario: Baseline refresh after an intentional change
- **WHEN** an intentional output change lands after oracle inversion
- **THEN** the stale baseline SHALL fail the gate until refreshed by the documented protocol, and a red run SHALL NOT overwrite any baseline

#### Scenario: Refresh authorization does not match exact drift
- **WHEN** a requested refresh has an absent intent, an unregistered unit or artifact, or a mismatched baseline or candidate content identity
- **THEN** the refresh SHALL fail before replacing either committed mode baseline

## MODIFIED Requirements

### Requirement: Differential comparison at the raw NAPI boundary

The parity harness SHALL execute the v2 extraction engine over the fixture corpus and compare its outputs to committed v2 reference surfaces captured at the same raw NAPI boundary, before any TypeScript post-processing stage runs.

#### Scenario: Measurement point excludes post-processing

- **WHEN** the harness compares fresh v2 output with a committed reference surface
- **THEN** the compared artifacts are values returned by native extraction calls, and changes confined to TypeScript post-processing produce no parity differences

### Requirement: Per-artifact-class comparison surfaces

The harness SHALL compare each artifact class with its own comparison rule: emitted CSS by byte equality, transformed JavaScript and its per-file component flags by normalized structural equivalence, diagnostics as a sorted multiset, and manifest-derived observables by structural value. The surface SHALL include the parser invocation count, and baseline-only or candidate-only units SHALL diverge in every canonical artifact class.

#### Scenario: CSS compared by bytes

- **WHEN** fresh v2 and the committed baseline contain different CSS bytes for a fixture
- **THEN** the fixture is reported as divergent for the CSS artifact class

#### Scenario: Transformed code compared structurally

- **WHEN** fresh v2 and the baseline contain transformed code that parses to equivalent normalized ASTs but differs in quoting or embedded-object key order
- **THEN** the fixture is reported as identical for the code artifact class

#### Scenario: Derived observables include parser count

- **WHEN** fresh v2 changes a derived observable or parser invocation count while remaining within its parse budget
- **THEN** the fixture is reported as divergent for the observables artifact class

### Requirement: Emitted CSS parses cleanly

The harness SHALL parse the emitted CSS in committed and fresh v2 surfaces and report any fixture whose CSS fails to parse, regardless of equality outcome.

#### Scenario: Unparseable CSS is its own failure

- **WHEN** a committed or fresh v2 surface contains CSS that fails to parse
- **THEN** the harness reports a CSS-validity failure for that fixture, distinct from content divergence

### Requirement: Divergence register gating

An active register entry SHALL classify drift only when its category is allowed and its unit, artifact class, baseline content identity, and candidate content identity match exactly. Ordinary committed-baseline verification SHALL exit non-zero on every divergence even when registered. A privileged refresh SHALL proceed only when every drift is exactly registered and no active entry is stale.

#### Scenario: Registered drift remains visible and red

- **WHEN** ordinary verification observes drift covered by an exact active register entry
- **THEN** the scoreboard identifies its category and the harness exits non-zero while the committed baseline is stale

#### Scenario: Exact registration authorizes refresh

- **WHEN** privileged refresh observes only exact registered drift and all other refresh gates pass
- **THEN** the refresh may replace the committed mode pair atomically

### Requirement: Self-check mode

The harness SHALL run fresh v2 processes twice over the corpus and byte-compare the declared surface, including runs at different thread counts; baseline recording SHALL be refused while either mode reports any difference.

#### Scenario: Self-check gates baselines

- **WHEN** fresh-process or thread-count self-check reports a nonempty difference in either mode
- **THEN** the harness refuses to record or update either committed baseline

#### Scenario: Thread-count variation checked for v2

- **WHEN** v2 runs the corpus at one thread and at N threads
- **THEN** the compared outputs are identical

### Requirement: Parse-count reporting

The harness SHALL retain the parser invocation count per fixture as a committed observable and SHALL fail fresh v2 when its parse count exceeds the number of source files in that fixture build.

#### Scenario: Excess parse detected

- **WHEN** v2 parses any file more than once during a fixture build
- **THEN** the harness reports the fixture and exits non-zero

#### Scenario: In-budget parse drift is stale

- **WHEN** fresh v2's parse count differs from the committed count without exceeding the budget
- **THEN** ordinary verification reports observable drift and exits non-zero

### Requirement: Diagnostics multiset comparison

The harness SHALL compare committed and fresh v2 diagnostics for each fixture as a sorted multiset and report differences alongside artifact divergences.

#### Scenario: Dropped warning is visible

- **WHEN** a committed diagnostic is absent from fresh v2 output
- **THEN** the scoreboard reports a diagnostics divergence for that fixture
