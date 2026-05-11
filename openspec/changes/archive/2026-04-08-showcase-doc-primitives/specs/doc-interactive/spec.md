## ADDED Requirements

### Requirement: TabGroup component

A generic tab bar component. The component SHALL accept `tabs` (string array), `activeTab` (string), and `onChange` (callback). It SHALL render a horizontal row of tab buttons with an active indicator (bottom border accent color). It SHALL be a controlled component — the parent manages active state.

#### Scenario: Active tab rendering
- **WHEN** TabGroup renders with tabs=["preview","code"] and activeTab="preview"
- **THEN** the "preview" tab has accent bottom border and full-color text; "code" tab has transparent border and dim text

#### Scenario: Tab click
- **WHEN** user clicks the "code" tab
- **THEN** onChange is called with "code"

#### Scenario: Styling
- **WHEN** TabGroup renders
- **THEN** tabs use monospace font, have a shared bottom border line, and the active indicator transitions smoothly

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

### Requirement: ChainStep component

An interactive builder chain visualization component. The component SHALL accept `steps` (array of `{label: string, layer: string}`), `activeStep` (number index), and `onStepClick` (callback with index). It SHALL render each step as a clickable button showing the method name and its corresponding @layer, with SVG arrow connectors between steps.

#### Scenario: Step rendering
- **WHEN** ChainStep renders with 6 steps (styles→variants→compounds→states→system→custom)
- **THEN** it displays 6 clickable buttons with arrow connectors between them

#### Scenario: Active step highlighting
- **WHEN** step index 2 is active
- **THEN** the ".compound()" button has accent background/border; all others have default styling

#### Scenario: Step click
- **WHEN** user clicks the ".variant()" step
- **THEN** onStepClick is called with the step index (1)

#### Scenario: Responsive wrapping
- **WHEN** the container is narrower than the full chain width
- **THEN** steps wrap to the next line gracefully (flex-wrap)
