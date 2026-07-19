## ADDED Requirements

### Requirement: Non-mutating candidate evaluation

The harness SHALL evaluate multiple candidate edits against a StyleGoal without mutating the workspace, and SHALL commit at most one selected candidate.

#### Scenario: Best-of-N evaluation

- **WHEN** N candidate edits are submitted against one StyleGoal
- **THEN** each receives a verdict-bearing answer, the workspace on disk is unchanged during evaluation, and at most one candidate is subsequently applied

### Requirement: Verdict-ordered scoring

Candidate scoring SHALL rank verdicts `exact` above `conditional` above `divergent` above `unverifiable`, and SHALL NOT rank any `unverifiable` candidate at or above any `divergent` candidate.

#### Scenario: Blind candidate loses to a wrong candidate

- **WHEN** the candidate set contains one `divergent` candidate and one `unverifiable` candidate
- **THEN** the `divergent` candidate ranks strictly higher

#### Scenario: Preserve violations disqualify

- **WHEN** a candidate's answer reports a violated preserve constraint
- **THEN** that candidate is not selectable regardless of its verdict rank
