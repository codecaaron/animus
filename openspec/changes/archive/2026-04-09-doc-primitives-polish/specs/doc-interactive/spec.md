## MODIFIED Requirements

### Requirement: ChainStep uses states instead of duplicate elements
ChainStep SHALL use `.states({ active })` on a single StepLabel and single LayerLabel element instead of maintaining separate StepLabel/StepLabelActive and LayerLabel/LayerLabelActive element pairs.

#### Scenario: Active step label styling
- **WHEN** a step is active
- **THEN** the StepLabel SHALL receive `active` state prop producing `color: 'primary'` via `@layer states`
- **AND** the LayerLabel SHALL receive `active` state prop producing `color: '{colors.fire.700}'` via `@layer states`

#### Scenario: Inline wrapper replaced
- **WHEN** ChainStep renders step items
- **THEN** the wrapper around each step+connector SHALL be a ds element, not a raw `<div style={...}>`

### Requirement: TabGroup keyboard navigation
TabGroup SHALL implement WAI-ARIA Tabs keyboard navigation with roving tabindex.

#### Scenario: Arrow key navigation
- **WHEN** focus is on a tab and user presses ArrowRight
- **THEN** focus SHALL move to the next tab and activate it
- **AND** the previous tab SHALL receive `tabIndex={-1}`, the new tab `tabIndex={0}`

#### Scenario: Wrap-around navigation
- **WHEN** focus is on the last tab and user presses ArrowRight
- **THEN** focus SHALL wrap to the first tab

#### Scenario: Home/End keys
- **WHEN** user presses Home while focused on any tab
- **THEN** focus SHALL move to the first tab
- **WHEN** user presses End
- **THEN** focus SHALL move to the last tab

### Requirement: TabGroup focus visibility
TabButton SHALL display a visible focus indicator via `_focusVisible` selector alias.

#### Scenario: Keyboard focus on tab
- **WHEN** user navigates to a tab via keyboard
- **THEN** a focus ring SHALL appear on the focused tab button
