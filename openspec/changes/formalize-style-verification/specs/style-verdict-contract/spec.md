## ADDED Requirements

### Requirement: Four-valued verdict taxonomy

Every answer produced by the style-verification harness SHALL carry exactly one verdict from the closed set `exact`, `divergent`, `conditional`, `unverifiable`.

#### Scenario: Prediction matches the goal

- **WHEN** a StyleGoal's required declarations match the kernel's predicted winning declarations for the goal's environment
- **THEN** the answer's verdict is `exact`

#### Scenario: Prediction contradicts the goal

- **WHEN** the kernel's predicted winning declarations differ from the goal's required declarations
- **THEN** the answer's verdict is `divergent` and the answer names each differing property with its predicted winner

#### Scenario: Outcome depends on context outside the model

- **WHEN** a required property's outcome depends on a dynamic scalar slot, a contextual variable, a runtime theme override, or stylesheet content outside the Animus layer model
- **THEN** the answer's verdict is `conditional` and the answer names the dependency

#### Scenario: The edit region is invisible to analysis

- **WHEN** the goal's component carries a spread-presence marker at a relevant element, or its facts predate spread-marker support
- **THEN** the answer's verdict is `unverifiable` and the answer includes the file and byte span of each blinding site

### Requirement: Evidence envelope on every answer

Every answer SHALL include an evidence envelope containing the supporting source facts and generated declarations, the environment (mode, engine identity, contract schema version), the assumptions applied, and a boolean `runtime_confirmation_required`.

#### Scenario: Auditing an exact answer

- **WHEN** a consumer receives an answer with verdict `exact`
- **THEN** the envelope names the manifest facts and declarations that support the verdict, and the environment identifies the mode, engine, and schema version that produced it

#### Scenario: Runtime confirmation flag

- **WHEN** any part of the answer rests on a named symbolic hole
- **THEN** `runtime_confirmation_required` is `true`

### Requirement: Versioned contract detection

Every answer SHALL carry a contract schema version, and a consumer presented with an unsupported version SHALL be able to detect the mismatch from the answer alone.

#### Scenario: Consumer behind the contract

- **WHEN** a consumer supporting schema version N receives an answer stamped N+1
- **THEN** the version field alone is sufficient to detect the mismatch without parsing the remainder of the answer

### Requirement: StyleGoal evaluation

The harness SHALL accept a typed StyleGoal — component, environment (mode, breakpoint, states, theme/color mode), required declarations, and preserve constraints — and SHALL evaluate it to a verdict-bearing answer without a browser or dev server.

#### Scenario: Goal with environment selection

- **WHEN** a StyleGoal requires `gap: 16px` on component `Button` at breakpoint `md` with state `hover` in production mode
- **THEN** the harness evaluates the goal against the predicted winning declarations for exactly that environment and returns a verdict-bearing answer

#### Scenario: Preserve constraints

- **WHEN** a StyleGoal declares `noNewDrops` and evaluation of a candidate edit predicts a new drop outcome
- **THEN** the answer reports the preserve violation with the dropping prop and site
