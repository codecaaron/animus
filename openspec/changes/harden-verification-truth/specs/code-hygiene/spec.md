## ADDED Requirements

### Requirement: Risky file deletion blocks completion

The hygiene orchestrator SHALL exit non-zero for a run containing a Layer D whole-file deletion unless the same run records the required behavior-build proof.

#### Scenario: Whole file is deleted without build proof

- **WHEN** the receipt stream contains `layer="D"`, `verb="delete"`, and `kind="file"` and no behavior-build proof is recorded
- **THEN** the verdict requires manual review and the orchestrator exits non-zero after its safety envelope

#### Scenario: Export-only cleanup completes

- **WHEN** the receipt stream contains no whole-file deletion and the cascade converges with a passing safety envelope
- **THEN** the whole-file deletion policy does not change the successful exit status

