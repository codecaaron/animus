## ADDED Requirements

### Requirement: Verbose timing waterfall display
When verbose mode is enabled, the vite-plugin SHALL display a per-phase timing waterfall after extraction completes. The waterfall SHALL follow the existing single-line extraction summary.

#### Scenario: Verbose buildStart shows phase breakdown
- **WHEN** `verbose: true` or `ANIMUS_DEBUG=1` is set and `buildStart` completes extraction
- **THEN** the plugin SHALL log the existing summary line (`Extracted N/M components (Xms)`) followed by indented per-phase lines showing phase name, duration in ms, and file stats for the parse phase

#### Scenario: Verbose HMR shows phase breakdown
- **WHEN** verbose mode is enabled and an HMR update triggers re-analysis
- **THEN** the plugin SHALL log the per-phase waterfall after the HMR timing summary

#### Scenario: Non-verbose mode unchanged
- **WHEN** `verbose` is false and `ANIMUS_DEBUG` is not set
- **THEN** no timing waterfall SHALL be displayed — existing behavior preserved
