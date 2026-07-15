# vite-extraction-plugin

## MODIFIED Requirements

### Requirement: Engine selection option

The plugin options SHALL include an optional engine field accepting v1 or v2, defaulting to v2, and the plugin SHALL route all extraction calls for a build through the selected engine. `'v1'` SHALL remain selectable and functional until v1 is retired.

#### Scenario: Unconfigured plugin uses v2

- **WHEN** `animusExtract` is constructed without an `engine` option
- **THEN** analysis and transformation SHALL be served by the v2 engine handle

#### Scenario: v2 routes to the v2 engine

- **WHEN** plugin options set engine to v2
- **THEN** all native extraction calls for that build execute against the v2 engine

#### Scenario: Escape hatch selects v1

- **WHEN** `engine: 'v1'` is configured
- **THEN** the v1 function API SHALL serve the build with output unchanged from pre-flip releases
