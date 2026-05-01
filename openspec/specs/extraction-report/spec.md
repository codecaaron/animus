## ADDED Requirements

### Requirement: Extraction report in manifest

The UniverseManifest SHALL include a `report` field containing a flat structured summary of extraction results: component counts, variant/state elimination counts, and details of eliminated rules.

#### Scenario: Report component counts

- **WHEN** the project has 12 components, 10 extracted, 1 eliminated (unused)
- **THEN** `report` SHALL contain flat fields `components_total: 12`, `components_extracted: 10`, `components_eliminated: 1`

#### Scenario: Report variant elimination

- **WHEN** the project has 18 variant options total, 8 used, 10 eliminated
- **THEN** `report` SHALL contain flat fields `variants_total: 18`, `variants_used: 8`, `variants_eliminated: 10`

#### Scenario: Report state elimination

- **WHEN** the project has 27 states total, 9 used, 18 eliminated
- **THEN** `report` SHALL contain flat fields `states_total: 27`, `states_used: 9`, `states_eliminated: 18`

#### Scenario: Report elimination details

- **WHEN** component Spacer is eliminated and Button variant "ghost" is eliminated and Layout state "loading" is eliminated
- **THEN** `report.eliminated_details` SHALL contain entries with shape `{ component: String, kind: String, name: String|null, reason: String }` where `kind` is `"component"`, `"variant"`, or `"state"`, and `name` is the option/state name (null for whole-component elimination)
