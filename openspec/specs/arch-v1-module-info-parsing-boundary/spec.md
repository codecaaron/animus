# arch-v1-module-info-parsing-boundary Specification

## Purpose
TBD - created by archiving change extract-v1-named-export-collection. Update Purpose after archive.
## Requirements
### Requirement: Capability retired with the v1 engine

The v1 module-analysis boundaries this capability governed were deleted with the v1 crate (`retire-extract-v1`). No v1 module-analysis code SHALL be reintroduced; the record lives in the archive (`2026-07-20-extract-v1-named-export-collection`).

#### Scenario: Subject code stays absent

- **WHEN** `ls packages/extract/src packages/extract/Cargo.toml` runs
- **THEN** neither path exists (the v1 crate is gone and stays gone)

