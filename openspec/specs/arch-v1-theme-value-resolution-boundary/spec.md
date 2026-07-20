# arch-v1-theme-value-resolution-boundary Specification

## Purpose
TBD - created by archiving change extract-v1-named-export-collection. Update Purpose after archive.
## Requirements
### Requirement: Capability retired with the v1 engine

The v1 theme-value resolution boundary this capability governed was deleted with the v1 crate (`retire-extract-v1`); it SHALL NOT be reintroduced. v2 theme-value behavior is owned by the parity tier's committed baselines and the extract-v2 unit suite.

#### Scenario: Subject code stays absent

- **WHEN** `ls packages/extract/src/theme_resolver.rs` runs
- **THEN** the file does not exist

