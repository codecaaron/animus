# vite-extraction-plugin

## ADDED Requirements

### Requirement: Engine selection option

The plugin options SHALL include an optional engine field accepting v1 or v2, defaulting to v1, and the plugin SHALL route all extraction calls for a build through the selected engine.

#### Scenario: Unset engine preserves behavior

- WHEN plugin options omit the engine field
- THEN the plugin behaves identically to versions predating the field

#### Scenario: v2 routes to the v2 engine

- WHEN plugin options set engine to v2
- THEN all native extraction calls for that build execute against the v2 engine
