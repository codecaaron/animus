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

### Requirement: Emitted CSS is always parseable
The extraction pipeline SHALL NOT emit CSS that fails standards-based parsing. An unresolvable token alias SHALL NOT pass through as a raw `{scale.path}` literal; the carrying declaration SHALL be dropped or replaced with a diagnosed fallback.

#### Scenario: Unresolvable alias in a component style
- **WHEN** a style value references a token alias absent from the theme and variable map
- **THEN** the emitted sheets SHALL parse cleanly under the harness css-validity check and a diagnostic SHALL identify the component, property, and unresolved alias
