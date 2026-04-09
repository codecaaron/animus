## MODIFIED Requirements

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

### Requirement: ChainStep displays arrow connectors
ChainStep SHALL use lucide-react icons for arrow connectors between steps instead of inline SVGs. Visual appearance and step active state behavior remain unchanged.

#### Scenario: ChainStep renders connector arrows
- **WHEN** ChainStep renders with multiple steps
- **THEN** arrow connectors between steps use lucide icons with `currentColor`
