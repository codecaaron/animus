# dual-engine-build

## ADDED Requirements

### Requirement: Engine identity in verification receipts

While two extractor engines coexist, every consumer-facing verification lane SHALL emit a machine-readable receipt recording: the lane name, host framework and version, execution mode, engine loaded, the default engine for that consumer, whether an engine override was applied, and the package form consumed (`workspace` or `packed`).

#### Scenario: Consumer lane completes

- **WHEN** `verify:next`, `verify:vite`, an assert tier, or `verify:packed` completes
- **THEN** a receipt exists containing lane, host, host version, mode, engine loaded, default engine, override flag, and package form

#### Scenario: Default engine flips for a consumer

- **WHEN** a consumer's default engine changes between two runs of the same lane
- **THEN** the two receipts differ in their recorded default engine, making the flip observable without reading lane logs

### Requirement: Engine execution scope across lanes

Consumer fixture lanes SHALL exercise each consumer's intended default engine; the packed consumer lane SHALL prove both engines load; semantic equivalence between engines SHALL remain the responsibility of the parity tier. No lane is required to execute every host under both engines.

#### Scenario: Consumer fixture lane runs

- **WHEN** a consumer fixture lane executes
- **THEN** extraction runs under that consumer's default engine and the receipt records it

#### Scenario: Cross-engine semantic question arises

- **WHEN** output equivalence between engines is in question for a fixture input
- **THEN** the parity tier is the lane that answers it, over the shared fixture corpus
