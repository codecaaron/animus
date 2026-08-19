## Purpose

Requirements for the `doc-interactive` capability: TabGroup provides tabbed content switching; LivePreview component; ChainStep displays arrow connectors; and 4 more.
## Requirements
### Requirement: ChainStep displays arrow connectors

ChainStep SHALL use lucide-react icons for arrow connectors between steps instead of inline SVGs. Visual appearance and step active state behavior remain unchanged.

#### Scenario: ChainStep renders connector arrows

- **WHEN** ChainStep renders with multiple steps
- **THEN** arrow connectors between steps use lucide icons with `currentColor`

### Requirement: ChainStep uses states instead of duplicate elements

ChainStep SHALL use `.states({ active })` on a single StepLabel and single LayerLabel element instead of maintaining separate StepLabel/StepLabelActive and LayerLabel/LayerLabelActive element pairs.

#### Scenario: Active step label styling

- **WHEN** a step is active
- **THEN** the StepLabel SHALL receive `active` state prop producing `color: 'primary'` via `@layer states`
- **AND** the LayerLabel SHALL receive `active` state prop producing `color: '{colors.fire.700}'` via `@layer states`

#### Scenario: Inline wrapper replaced

- **WHEN** ChainStep renders step items
- **THEN** the wrapper around each step+connector SHALL be a ds element, not a raw `<div style={...}>`

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

