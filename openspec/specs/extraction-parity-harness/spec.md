# extraction-parity-harness Specification

## Purpose
TBD - created by archiving change extract-v2-spine. Update Purpose after archive.
## Requirements
### Requirement: Differential comparison at the raw NAPI boundary

The parity harness SHALL execute both extraction engines over the fixture corpus and compare their outputs captured at the raw NAPI boundary, before any TypeScript post-processing stage runs.

#### Scenario: Measurement point excludes post-processing

- WHEN the harness compares engine outputs for a fixture
- THEN the compared artifacts are the values returned by the native extraction calls, and changes confined to TypeScript post-processing produce no parity differences

### Requirement: Per-artifact-class comparison surfaces

The harness SHALL compare each artifact class with its own comparison rule: emitted CSS by byte equality, transformed JavaScript by normalized AST equivalence with key-order-insensitive comparison of embedded configuration object literals, and manifests by derived observables only (emitted CSS text, per-file transform results, per-layer sheet contents, per-component fragment values, the component-fragment key set, the reverse-provenance edge set, the consumer-composition strings compared post-parse, and the diagnostics multiset).

#### Scenario: CSS compared by bytes

- WHEN both engines emit CSS for a fixture and the bytes differ
- THEN the fixture is reported as divergent for the CSS artifact class

#### Scenario: Transformed code compared structurally

- WHEN both engines emit transformed code that parses to equivalent normalized ASTs but differs in quoting or embedded-object key order
- THEN the fixture is reported as identical for the code artifact class

#### Scenario: Manifests compared by derived observables

- WHEN both engines produce manifests whose serialized bytes differ but whose derived observables are equal
- THEN the fixture is reported as identical for the manifest artifact class

### Requirement: Diffable scoreboard with failure classification

The harness SHALL emit a scoreboard containing pass totals with percentages, a sorted list of every divergent fixture path, and a per-divergence classification; CSS divergences SHALL be classified automatically as one of formatting, rule-order, selector, or value via an order-aware parsed-CSS comparison.

#### Scenario: Divergent fixture appears in sorted list

- WHEN any fixture diverges
- THEN its path appears in the scoreboard's sorted failing list with an artifact class and classification

#### Scenario: CSS divergence classified

- WHEN two CSS outputs differ only in rule order within a layer
- THEN the scoreboard classifies that divergence as rule-order

### Requirement: Emitted CSS parses cleanly

The harness SHALL parse the emitted CSS of both engines and report any fixture whose CSS fails to parse, regardless of parity outcome.

#### Scenario: Unparseable CSS is its own failure

- WHEN an engine emits CSS that fails to parse
- THEN the harness reports a CSS-validity failure for that fixture and engine, distinct from parity divergence

### Requirement: Divergence register gating

The harness SHALL exit non-zero when any divergence lacks a corresponding register entry, and SHALL exit zero when every divergence is covered by a register entry carrying a category of intentional-correctness, ordering, v1-feature-drift, or known-quirk.

#### Scenario: Unregistered divergence fails the run

- WHEN a fixture diverges and no register entry covers it
- THEN the harness exits non-zero and the scoreboard marks the divergence unregistered

#### Scenario: Registered divergence passes with visibility

- WHEN a fixture diverges and a register entry covers it
- THEN the harness exits zero and the scoreboard lists the divergence with its register category

### Requirement: Self-check mode

The harness SHALL provide a self-check mode that runs a single engine twice over the corpus and byte-compares the declared comparison surface, and for the v2 engine additionally compares runs at different thread counts; baseline recording SHALL be refused while self-check reports any difference.

#### Scenario: Self-check gates baselines

- WHEN self-check reports a nonempty difference for the reference engine
- THEN the harness refuses to record or update parity baselines

#### Scenario: Thread-count variation checked for v2

- WHEN the v2 engine runs the corpus at one thread and at N threads
- THEN the compared outputs are identical

### Requirement: Parse-count reporting

The harness SHALL report, per fixture, the number of parser invocations each engine performed, and SHALL fail the v2 engine when its parse count for any build exceeds the number of source files in that build.

#### Scenario: Excess parse detected

- WHEN the v2 engine parses any file more than once during a fixture build
- THEN the harness reports the fixture and exits non-zero

### Requirement: Diagnostics multiset comparison

The harness SHALL compare the diagnostics emitted by both engines for each fixture as a multiset and report differences alongside artifact divergences.

#### Scenario: Dropped warning is visible

- WHEN one engine emits a warning for a fixture and the other emits none
- THEN the scoreboard reports a diagnostics divergence for that fixture

