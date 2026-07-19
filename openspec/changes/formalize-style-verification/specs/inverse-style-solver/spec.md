## ADDED Requirements

### Requirement: Ranked in-universe solving

Given a StyleGoal, the solver SHALL return candidate configurations from the enumerated universe whose predicted declarations satisfy the goal's requirements, ranked by edit distance from the current workspace state.

#### Scenario: Multiple satisfying configurations

- **WHEN** a partial goal is satisfiable by more than one (variant, state, prop) configuration
- **THEN** all found configurations are returned with the lowest-edit-distance candidate ranked first, each carrying a verdict-bearing answer

#### Scenario: Unsatisfiable within the universe

- **WHEN** no enumerated configuration satisfies the goal
- **THEN** the solver reports unsatisfiability over the enumerated region rather than returning a near-miss as satisfying

### Requirement: Universe-extension proposals

When the nearest satisfying answer lies outside the enumerated universe, the solver SHALL return explicitly-labeled universe-extension proposals — such as adding a scale value or a variant option — distinct from in-universe solutions.

#### Scenario: Off-scale target value

- **WHEN** a goal requires a spacing value absent from the theme's scale
- **THEN** the solver returns a labeled extension proposal naming the scale and the value, and does not present it as an in-universe solution
