## ADDED Requirements

### Requirement: Predicate bisection over ledger history

Given a predicate over universe state and a commit range with ledger coverage, the harness SHALL identify the first commit at which the predicate's truth value changes.

#### Scenario: Locating a style regression

- **WHEN** a predicate "component X's winning `color` declaration is D" holds at the range start and fails at the range end, with snapshots for every commit in the range
- **THEN** bisection names the first commit where it fails, with the universe diff at that commit as evidence

### Requirement: Graceful degradation on missing coverage

Commits without ledger coverage SHALL narrow the reported answer to a bounded range rather than produce a fabricated verdict.

#### Scenario: Gap in the ledger

- **WHEN** the flip lies inside a sub-range with no snapshots and on-demand analysis of those commits fails
- **THEN** the result reports the bounding commits and the coverage gap, and no single commit is asserted
