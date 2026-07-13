# transform-evaluation-contract

## ADDED Requirements

### Requirement: Recorded-expectation battery

The transform-evaluation seam SHALL satisfy a recorded-expectation battery covering, at minimum: string and number input coercion, numeric formatting at exponent thresholds, scale-key stringification distinctions (such as "8.0" versus "8"), value negation, transforms that throw, transform name collisions across files, and values containing carriage returns or other exotic characters; the battery SHALL be runnable against each engine and each evaluation path, reporting every expectation mismatch.

#### Scenario: Battery runs against both engines

- WHEN the battery executes against an engine's evaluation path
- THEN every case reports match or mismatch against its recorded expectation, and mismatches identify the case and the observed value

#### Scenario: Cross-file name collision behavior is pinned

- WHEN two files register transforms with the same name
- THEN the battery records which registration wins and flags any change in that outcome

### Requirement: Evaluation failures produce diagnostics under v2

When the v2 engine is selected, a failed transform evaluation SHALL produce a diagnostic identifying the file and transform, and the engine SHALL NOT substitute a fallback value silently.

#### Scenario: Throwing transform is visible

- WHEN a user transform throws during v2 extraction
- THEN the build's diagnostics include an entry naming the file and transform

#### Scenario: Unevaluable value is visible

- WHEN a style value cannot be marshalled into the evaluator under v2
- THEN a diagnostic is emitted and the raw value fallback, if applied, is reported rather than silent
