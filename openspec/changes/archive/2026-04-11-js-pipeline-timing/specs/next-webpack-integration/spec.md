## MODIFIED Requirements

### Requirement: Verbose timing display in next-plugin
When verbose mode is enabled, the next-plugin SHALL display hierarchical per-phase timing after extraction completes, using the same waterfall format as the vite-plugin. The zero-cost timer gate SHALL ensure no overhead when verbose is off.

#### Scenario: Verbose build shows hierarchical breakdown
- **WHEN** `verbose: true` is configured and a build triggers extraction
- **THEN** the plugin SHALL log the hierarchical waterfall showing JS phases with nested Rust PipelineTiming phases, matching the vite-plugin format

#### Scenario: Non-verbose mode unchanged
- **WHEN** `verbose` is false or not configured
- **THEN** no timing waterfall SHALL be displayed and no `performance.now()` calls SHALL occur
