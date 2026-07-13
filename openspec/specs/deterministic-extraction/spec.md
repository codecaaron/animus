# deterministic-extraction Specification

## Purpose
TBD - created by archiving change extract-v2-spine. Update Purpose after archive.
## Requirements
### Requirement: Repeat-run determinism

An extraction engine SHALL produce byte-identical emitted CSS and byte-identical transformed code for identical inputs across repeated runs in fresh processes.

#### Scenario: Two runs match

- WHEN the same project is extracted twice in separate processes with identical inputs
- THEN the emitted CSS and transformed code are byte-identical between runs

### Requirement: Thread-count determinism

The v2 engine SHALL produce byte-identical emitted CSS and transformed code regardless of the configured thread count.

#### Scenario: Parallelism does not change output

- WHEN the same project is extracted with one thread and with N threads
- THEN the outputs are byte-identical

### Requirement: Deterministic serialization of emitted configuration

Configuration objects embedded in transformed code SHALL serialize with a stable, sorted key order.

#### Scenario: Compound conditions serialize stably

- WHEN a component's emitted configuration contains a multi-key condition object
- THEN repeated extractions serialize its keys in the same order every time

