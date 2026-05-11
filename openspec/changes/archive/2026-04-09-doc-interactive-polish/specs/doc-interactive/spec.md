## MODIFIED Requirements

### Requirement: ChainStep provides interactive builder chain visualization
ChainStep (renamed to ChainVisualizer) SHALL accept enriched step data including `description`, `code`, `repeatable`, and `available` fields. The component renders a chain strip with step buttons, connector arrows, and a detail panel below showing per-step content.

#### Scenario: Step data with description and code
- **WHEN** ChainVisualizer renders with steps containing description and code fields
- **THEN** clicking a step shows its description and code example in the detail panel

#### Scenario: Active step has glow
- **WHEN** a step is active
- **THEN** the step button displays a box-shadow glow using token opacity syntax, in addition to the existing active background color

#### Scenario: Backward compatible with minimal step data
- **WHEN** ChainVisualizer renders with steps containing only `label` and `layer` (no description/code)
- **THEN** the chain strip renders as before with no detail panel
