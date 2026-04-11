## MODIFIED Requirements

### Requirement: Per-phase timing collection in project analyzer
The project analyzer SHALL collect wall-clock duration for each pipeline phase using `std::time::Instant`. Timing SHALL be collected unconditionally (not gated by a flag) because the overhead is negligible (~25ns per measurement point).

#### Scenario: All phases timed
- **WHEN** `analyze_project()` executes a full extraction
- **THEN** the returned manifest SHALL contain a `timing` object with millisecond durations for: `parseAndWalk`, `importResolution`, `extensionProvenance`, `topologicalSort`, `chainEvaluation`, `jsxScanning`, `systemPropAggregation`, `usageLedger`, `reconciliation`, `cssGeneration`, `manifestSerialization`

#### Scenario: Sub-millisecond phases report zero
- **WHEN** a phase completes in under 1 millisecond
- **THEN** its timing value SHALL be `0` (u64 truncation, not rounding)

#### Scenario: Cache-hit files skip parse timing
- **WHEN** Phase 1 encounters cached files that skip parsing
- **THEN** the `parseAndWalk` duration SHALL reflect only the time spent on cache-miss files (the actual parse work), and `cacheHits` SHALL report the count of skipped files

#### Scenario: Rust timing nests within JS analysis phase
- **WHEN** the JS plugin displays timing in verbose mode
- **THEN** the Rust `PipelineTiming` phases SHALL be displayed as a nested sub-tree under the JS `analysis.rustExtract` phase, showing the decomposition of NAPI call time
