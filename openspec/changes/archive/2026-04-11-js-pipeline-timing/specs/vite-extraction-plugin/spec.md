## MODIFIED Requirements

### Requirement: Verbose timing waterfall display
When verbose mode is enabled, the vite-plugin SHALL display a hierarchical per-phase timing waterfall after extraction completes. The waterfall SHALL nest JS-side phases around Rust-side phases, showing the complete cost decomposition from plugin entry to output.

#### Scenario: Verbose buildStart shows hierarchical breakdown
- **WHEN** `verbose: true` or `ANIMUS_DEBUG=1` is set and `buildStart` completes
- **THEN** the plugin SHALL log a hierarchical waterfall showing JS phases (system-load, file-discovery, file-read+hash, package-resolve, analysis) with the analysis phase decomposed into json-serialize, rust-extract (with nested Rust PipelineTiming phases), and json-parse

#### Scenario: Verbose HMR shows phase breakdown
- **WHEN** verbose mode is enabled and an HMR update triggers re-analysis
- **THEN** the plugin SHALL log the hierarchical waterfall after the HMR timing summary

#### Scenario: Non-verbose mode unchanged
- **WHEN** `verbose` is false and `ANIMUS_DEBUG` is not set
- **THEN** no timing waterfall SHALL be displayed and no `performance.now()` calls SHALL occur (zero-cost gate)

#### Scenario: Transform aggregate reported
- **WHEN** verbose mode is active and a build or HMR cycle completes transforms
- **THEN** the plugin SHALL log a transform summary line with total time, file count, min, max, and average per-file duration
