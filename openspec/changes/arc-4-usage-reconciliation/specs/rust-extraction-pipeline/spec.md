## MODIFIED Requirements

### Requirement: UniverseManifest structure
The manifest JSON SHALL contain: `components`, `utilities`, `css` (reconciled), `provenance`, `files`, `usage` (usage ledger data), and `report` (extraction report). The `css` field SHALL contain ONLY CSS for used variants, used states, and rendered components — dead rules SHALL be eliminated before CSS generation.

#### Scenario: Manifest with reconciled CSS
- **WHEN** the project has components with unused variant options and states
- **THEN** `manifest.css` SHALL NOT contain CSS rules for unused variant options or states

#### Scenario: Manifest with usage field
- **WHEN** the analysis completes
- **THEN** `manifest.usage` SHALL contain `{ rendered_components: [...], variant_usage: {...}, state_usage: {...} }`

#### Scenario: Manifest with report field
- **WHEN** the analysis completes
- **THEN** `manifest.report` SHALL contain `{ components: {...}, variants: {...}, states: {...}, css: {...}, eliminated_details: [...] }`
