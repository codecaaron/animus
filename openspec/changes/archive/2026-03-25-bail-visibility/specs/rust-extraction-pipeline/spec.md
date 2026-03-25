## ADDED Requirements

### Requirement: Project analyzer preserves skip warnings
The `analyze_project` function SHALL NOT discard per-property skip warnings. Skip warnings from each component's extraction SHALL be collected and included in the manifest output.

#### Scenario: Skip warnings in manifest JSON
- **WHEN** `analyze_project()` processes a file where property `color` is skipped due to a variable reference
- **THEN** the returned manifest JSON SHALL include the skip warning in the `diagnostics` array

#### Scenario: Bail reasons in manifest JSON
- **WHEN** `analyze_project()` encounters a chain that bails (e.g., spread element in style object)
- **THEN** the returned manifest JSON SHALL include the bail reason in the `diagnostics` array with the component binding name and file path
