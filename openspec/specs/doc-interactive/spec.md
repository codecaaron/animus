## Doc Interactive Specification

### Requirement: TabGroup provides tabbed content switching
TabGroup SHALL use ark-ui Tabs primitives for keyboard navigation, focus management, and panel association while maintaining the existing consumer API (`tabs`, `activeTab`, `onChange` props). The convenience wrapper absorbs ark-ui's internal API (`value`/`onValueChange`).

#### Scenario: TabGroup keyboard navigation via ark-ui
- **WHEN** user presses ArrowRight on a focused tab
- **THEN** focus moves to the next tab (with wrap-around), managed by ark-ui's Tabs primitive

#### Scenario: TabGroup panel association
- **WHEN** a tab is selected
- **THEN** the corresponding panel has `aria-labelledby` referencing the tab, and the tab has `aria-controls` referencing the panel

#### Scenario: TabGroup consumer API stable
- **WHEN** a consumer renders `<TabGroup tabs={['A','B']} activeTab="A" onChange={fn} />`
- **THEN** the component works identically to the pre-migration version

### Requirement: LivePreview component

A preview/code toggle panel for MDX documentation. The component SHALL accept `preview` (ReactNode — live rendered component), `code` (ReactNode — typically a SyntaxBlock), and optionally `defaultTab` (`'preview' | 'code'`, default `'preview'`). It SHALL render a bordered container with TabGroup toggling between the preview and code views.

#### Scenario: Default preview view
- **WHEN** LivePreview renders with preview and code props
- **THEN** the preview tab is active and the rendered component is visible in a padded container

#### Scenario: Switch to code view
- **WHEN** user clicks the "code" tab
- **THEN** the preview is hidden and the code content is displayed

#### Scenario: MDX usage
- **WHEN** an .mdx file uses `<LivePreview preview={<Button>Click</Button>} code={<SyntaxBlock>...</SyntaxBlock>} />`
- **THEN** both the live component and its source code are viewable via tab toggle

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
