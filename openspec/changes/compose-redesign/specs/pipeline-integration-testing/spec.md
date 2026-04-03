## MODIFIED Requirements

### Requirement: Compose through full extraction pipeline
The integration test suite SHALL exercise compose() output through the full extraction pipeline: composed components → serialize → `analyzeProject()` → transform → assert slot CSS and shared variant propagation.

#### Scenario: Composed family extracts slot CSS
- **WHEN** a composed family with Root and child slots is extracted through the full pipeline
- **THEN** each slot SHALL produce its own CSS rules with distinct class names

#### Scenario: Shared variants produce context-aware CSS
- **WHEN** a composed Root provides shared variant values and child slots consume them
- **THEN** the extracted CSS SHALL contain variant rules for each consuming slot

#### Scenario: Compose with strict Root convention
- **WHEN** integration test fixtures define composed families
- **THEN** the Root slot SHALL use the literal key `"Root"` (PascalCase), not lowercase `"root"`
