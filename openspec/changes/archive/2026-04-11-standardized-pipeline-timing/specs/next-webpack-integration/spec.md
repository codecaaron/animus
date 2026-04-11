## ADDED Requirements

### Requirement: Verbose timing display in next-plugin
When verbose mode is enabled, the next-plugin SHALL display per-phase timing after extraction completes, using the same waterfall format as the vite-plugin.

#### Scenario: Verbose build shows phase breakdown
- **WHEN** `verbose: true` is configured in the next-plugin options and a build or watch-run triggers extraction
- **THEN** the plugin SHALL log the extraction summary followed by indented per-phase timing lines

#### Scenario: Non-verbose mode unchanged
- **WHEN** `verbose` is false or not configured
- **THEN** no timing waterfall SHALL be displayed
