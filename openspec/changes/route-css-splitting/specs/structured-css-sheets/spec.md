## ADDED Requirements

### Requirement: Per-component CSS map alongside CssSheets
The `UniverseManifest` SHALL include a `component_css` field mapping each component_id to its individual CSS fragments. This is additive to the existing `CssSheets` which contains concatenated per-layer strings.

#### Scenario: Manifest contains both formats
- **WHEN** `analyze_project()` completes
- **THEN** the returned manifest SHALL contain both `sheets` (concatenated per-layer, for single-file mode) and `component_css` (per-component fragments, for splitting mode)

#### Scenario: Per-component fragments match concatenated output
- **WHEN** all per-component CSS fragments for a given layer are concatenated in topological order
- **THEN** the result SHALL be identical to the corresponding field in `CssSheets`
