# transform-evaluation-contract

## ADDED Requirements

### Requirement: Directive detection tolerates leading trivia
`'use client'` detection SHALL recognize the directive in the directive prologue position per ECMAScript semantics, including when preceded by comments or blank lines; injected imports SHALL always land below the directive.

#### Scenario: Comment precedes the directive
- **WHEN** a transformed file begins with a comment line followed by `'use client'`
- **THEN** the emitted file SHALL keep the directive above all import statements

### Requirement: Imports are emitted only for referenced runtime capabilities
Runtime and virtual-module imports SHALL be emitted only when the transformed output requires the corresponding runtime capability; user string content SHALL NOT trigger imports.

#### Scenario: User string contains an import-trigger token
- **WHEN** a component's style or config value contains the literal text `transforms.`
- **THEN** no transforms-registry import SHALL be added unless the transformed component references a named transform

## MODIFIED Requirements

### Requirement: Recorded-expectation battery

The transform-evaluation seam SHALL satisfy an immutable recorded-expectation battery covering, at minimum: string and number input coercion, numeric formatting at exponent thresholds, scale-key stringification distinctions, value negation, transforms that throw, transform name collisions across files, and values containing carriage returns or other exotic characters. The standing battery SHALL execute the v2 production evaluation path, report baseline-only, candidate-only, and changed cases, and replace its oracle only through an atomic journal-authorized recorder.

#### Scenario: Battery runs against the v2 evaluation path

- **WHEN** the standing battery executes
- **THEN** every current and recorded case reports match or mismatch against its recorded expectation, and mismatches identify the case

#### Scenario: Cross-file name collision behavior is pinned

- **WHEN** two files register transforms with the same name
- **THEN** the battery records which registration wins and flags any change in that outcome

#### Scenario: Failed recording preserves the oracle

- **WHEN** a seam-baseline recording fails before atomic publication
- **THEN** the previously committed oracle remains byte-for-byte intact
