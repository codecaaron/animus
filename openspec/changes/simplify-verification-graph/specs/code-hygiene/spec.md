## MODIFIED Requirements

### Requirement: Layer D high-volume removals trigger an informational nudge

For export-volume Layer D nudges, the hygiene orchestrator SHALL retain the existing informational-only exit behavior and thresholds. The nudge SHALL recommend a claim-oriented verification command: a package owner claim for a local owner, a fail-closed dependent-owner filter for a shared package, or `vp run verify:full` when the affected build-time consumer is uncertain. It SHALL NOT recommend the removed root `verify:build:*` family.

This requirement changes command wording only. It does not determine the overall hygiene verdict. A whole-file deletion remains subject to the active blocking behavior-proof policy and MAY make the run non-zero.

#### Scenario: Single Layer D file removal triggers the NOTE

- **WHEN** a Layer D file removal crosses the existing threshold
- **THEN** the summary includes a claim-oriented build-time-consumer verification message
- **AND** its exit status follows the separate whole-file behavior-proof policy

#### Scenario: Five Layer D export removals trigger the NOTE

- **WHEN** five Layer D export removals cross the existing threshold
- **THEN** the same claim-oriented nudge is emitted

#### Scenario: Two Layer D export removals do not trigger the NOTE

- **WHEN** only two Layer D export removals occur
- **THEN** no high-volume nudge is emitted
