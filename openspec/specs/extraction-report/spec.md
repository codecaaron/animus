## Purpose

Requirements for the `extraction-report` capability: Extraction report in manifest.
## Requirements
### Requirement: Extraction report in manifest

The UniverseManifest SHALL include a `report` field containing a flat structured summary of extraction results: component counts, variant/state elimination counts, forced-emission counts, and details of eliminated and forced rules.

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
- **THEN** `report.eliminated_details` SHALL contain entries with shape `{ component: String, kind: String, name: String|null, reason: String }` where `kind` is `"component"`, `"variant"`, `"state"`, or `"forced"`, and `name` is the option/state name (null for whole-component elimination)

#### Scenario: Report forced-emission counts

- **WHEN** forced declarations keep 1 otherwise-unrendered component, 3 variant options, and 2 states
- **THEN** `report` SHALL contain flat fields `components_forced: 1`, `variants_forced: 3`, `states_forced: 2`

#### Scenario: Forced entries carry labeled details

- **WHEN** a variant option is emitted solely due to a forced declaration
- **THEN** `report.eliminated_details` SHALL contain an entry with `kind: "forced"` naming the component and option, with a reason indicating the forced origin

