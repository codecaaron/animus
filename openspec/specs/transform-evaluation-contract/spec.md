# transform-evaluation-contract Specification

## Purpose
TBD - created by archiving change extract-v2-spine. Update Purpose after archive.
## Requirements
### Requirement: Recorded-expectation battery

The transform-evaluation seam SHALL satisfy an immutable recorded-expectation battery covering, at minimum: string and number input coercion, numeric formatting at exponent thresholds, scale-key stringification distinctions, value negation, transforms that throw, transform name collisions across files, values containing carriage returns or other exotic characters, and result-shape rejections for each invalid shape (object, array, null, boolean, undefined, function, symbol, bigint, NaN, +Infinity, -Infinity) including `toString`-wrapper and boxed-primitive representatives. The standing battery SHALL execute the v2 production evaluation path, report baseline-only, candidate-only, and changed cases, and replace its oracle only through an atomic journal-authorized recorder.

#### Scenario: Battery runs against the v2 evaluation path

- **WHEN** the standing battery executes
- **THEN** every current and recorded case reports match or mismatch against its recorded expectation, and mismatches identify the case

#### Scenario: Cross-file name collision behavior is pinned

- **WHEN** two files register transforms with the same name
- **THEN** the battery records which registration wins and flags any change in that outcome

#### Scenario: Failed recording preserves the oracle

- **WHEN** a seam-baseline recording fails before atomic publication
- **THEN** the previously committed oracle remains byte-for-byte intact

#### Scenario: Rejection cases recorded alongside untouched valid cases

- **WHEN** the battery oracle is refreshed to add result-shape rejection cases
- **THEN** every pre-existing valid-result expectation remains byte-for-byte identical, and each invalid shape has a recorded rejection expectation

### Requirement: Evaluation failures produce diagnostics under v2

When the v2 engine is selected, a failed transform evaluation SHALL produce a diagnostic identifying the file and transform, and the engine SHALL NOT substitute a fallback value silently. An invalid result shape SHALL produce an error-severity diagnostic and no emitted declaration for the affected value; a thrown transform SHALL produce a warning diagnostic that reports the raw-value fallback when one is applied.

#### Scenario: Throwing transform is visible

- **WHEN** a user transform throws during v2 extraction
- **THEN** the build's diagnostics include an entry naming the file and transform

#### Scenario: Unevaluable value is visible

- **WHEN** a style value cannot be marshalled into the evaluator under v2
- **THEN** a diagnostic is emitted and the raw value fallback, if applied, is reported rather than silent

#### Scenario: Invalid result shape yields an error diagnostic and no declaration

- **WHEN** a transform returns an object for a statically-resolved value
- **THEN** the manifest diagnostics include an entry with kind `error` naming the file and transform, and the affected declaration is absent from the emitted CSS

#### Scenario: Raw-value fallback after a throw is reported

- **WHEN** a transform throws and the raw value is applied as the declaration value
- **THEN** the manifest diagnostics include a warning entry naming the file and transform and stating that the raw value was applied

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

### Requirement: Transform result shape validation

Transform evaluation SHALL accept only results that are strings or finite numbers; any other result — object (including `toString`-implementing wrappers and boxed primitives), array, function, boolean, null, undefined, symbol, bigint, NaN, or ±Infinity — SHALL be classified as an invalid result shape, drawn from a closed descriptor set, distinctly from a thrown transform, and SHALL never be coerced into a CSS value on any path.

#### Scenario: Object result classified as invalid shape

- **WHEN** a registered transform returns `{ width: '4px' }` during build-time evaluation
- **THEN** evaluation reports an invalid-result-shape outcome identifying the shape as `object`, and no coerced string of that result appears in any emitted CSS

#### Scenario: Non-finite number classified as invalid shape

- **WHEN** a transform returns `NaN` or `Infinity` during build-time evaluation
- **THEN** evaluation reports an invalid-result-shape outcome identifying the shape as `non-finite-number`

#### Scenario: Invalid shape distinguished from thrown transform

- **WHEN** one transform returns an array and another transform throws an error
- **THEN** the two evaluations report distinguishable outcomes: invalid result shape for the first, thrown transform for the second

#### Scenario: Shape descriptors come from a closed set

- **WHEN** a transform throws an error whose own message embeds the invalid-result protocol text followed by arbitrary trailing content
- **THEN** the evaluation reports a thrown-transform outcome, and no descriptor outside the closed set (object, array, null, boolean, undefined, function, symbol, bigint, non-finite-number) is ever reported

#### Scenario: Coercible wrapper objects are rejected, not stringified

- **WHEN** a transform returns a `toString`-implementing object or a boxed String whose coercion would yield valid CSS text
- **THEN** evaluation reports an invalid-result-shape outcome and the coerced text does not reach any emitted CSS

#### Scenario: Valid results unchanged

- **WHEN** a transform returns the string `"28px"` or the finite number `28`
- **THEN** the evaluated CSS value is byte-identical to the value produced before result-shape validation existed

