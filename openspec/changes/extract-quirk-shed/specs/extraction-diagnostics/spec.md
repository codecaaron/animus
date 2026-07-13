# extraction-diagnostics

## ADDED Requirements

### Requirement: Eval-failed chains are diagnosed
A builder chain dropped because stage evaluation failed SHALL emit a bail diagnostic naming the file, binding, and failing stage; silent disappearance from the manifest SHALL NOT occur.

#### Scenario: Props config rejected at deserialization
- **WHEN** a `.props()` argument evaluates statically but fails config deserialization
- **THEN** the manifest diagnostics SHALL contain a bail entry for that binding and the source file SHALL be left untransformed for that chain

### Requirement: Unresolved-alias leaks are diagnosed
Token aliases that cannot resolve SHALL produce a warn diagnostic (see deterministic-extraction for the output requirement).

#### Scenario: Alias diagnostic surfaces in dev
- **WHEN** dev-mode analysis encounters an unresolvable alias
- **THEN** the plugin diagnostics channel SHALL surface the warn entry with file and property context
