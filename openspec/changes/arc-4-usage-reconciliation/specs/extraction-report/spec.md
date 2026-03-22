## ADDED Requirements

### Requirement: Extraction report in manifest
The UniverseManifest SHALL include a `report` field containing a structured summary of extraction results: component counts, variant/state elimination counts, CSS size comparison, and details of eliminated rules.

#### Scenario: Report component counts
- **WHEN** the project has 12 components, 10 extracted, 2 bailed, 1 eliminated (unused)
- **THEN** `report.components` SHALL contain `{ total: 12, extracted: 10, bailed: 2, eliminated: 1 }`

#### Scenario: Report variant elimination
- **WHEN** the project has 18 variant options total, 8 used, 10 eliminated
- **THEN** `report.variants` SHALL contain `{ total_options: 18, used: 8, eliminated: 10 }`

#### Scenario: Report state elimination
- **WHEN** the project has 27 states total, 9 used, 18 eliminated
- **THEN** `report.states` SHALL contain `{ total: 27, used: 9, eliminated: 18 }`

#### Scenario: Report CSS size reduction
- **WHEN** pre-reconciliation CSS is 4280 bytes and post-reconciliation is 2640 bytes
- **THEN** `report.css` SHALL contain `{ before_reconciliation_bytes, after_reconciliation_bytes, reduction_percent }` with accurate values

#### Scenario: Report elimination details
- **WHEN** component GridBox is eliminated and Button variant "fill" is eliminated
- **THEN** `report.eliminated_details` SHALL contain entries like `{ component: "GridBox", reason: "component never rendered" }` and `{ component: "Button", variant: "fill", reason: "variant option never used" }`
