## MODIFIED Requirements

### Requirement: Project-level analysis NAPI entry point
The Rust crate SHALL export `analyze_project(file_entries_json, theme_json, config_json, group_registry_json) -> String` that performs full-codebase static analysis including usage-based reconciliation and returns a JSON UniverseManifest. The manifest SHALL include `usage` (the usage ledger data) and `report` (the extraction report) fields alongside existing fields.

#### Scenario: Manifest with reconciled CSS
- **WHEN** `analyze_project` is called with files containing components where some variants and states are never used at any callsite
- **THEN** the manifest's `css` field SHALL contain only CSS rules for used variant options and activated states — unused rules SHALL be eliminated

#### Scenario: Manifest with usage data
- **WHEN** `analyze_project` completes analysis
- **THEN** the manifest SHALL include a `usage` field containing `rendered_components`, `variant_usage`, and `state_usage` data from the usage ledger

#### Scenario: Manifest with extraction report
- **WHEN** `analyze_project` completes analysis
- **THEN** the manifest SHALL include a `report` field with flat component/variant/state elimination counts and an `eliminated_details` array

#### Scenario: Reconciliation phase ordering
- **WHEN** the project analyzer runs
- **THEN** the reconciliation phase SHALL execute AFTER chain evaluation and JSX scanning but BEFORE CSS generation — the CSS generator receives already-reconciled ComponentCss data
