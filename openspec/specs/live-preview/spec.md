## Live Preview Specification

### Requirement: Preview area displays dot grid background
The preview pane of LivePreview SHALL render a dot grid canvas background using `radial-gradient` with `{colors.text.dim/8}` at 20px spacing.

#### Scenario: Preview tab active
- **WHEN** the preview tab is selected
- **THEN** the preview content area displays a subtle dot grid pattern behind the rendered component

#### Scenario: Code tab active
- **WHEN** the code tab is selected
- **THEN** no dot grid is visible — only the code block renders

### Requirement: Variant controls toolbar
LivePreview SHALL accept an optional `variants` prop (`Record<string, string[]>`) that renders a segmented control toolbar for switching between variant values.

#### Scenario: Single variant axis
- **WHEN** LivePreview renders with `variants={{ size: ['sm', 'md', 'lg'] }}`
- **THEN** a segmented control with "sm", "md", "lg" buttons appears in the toolbar, defaulting to the first value

#### Scenario: Variant selection updates preview
- **WHEN** user clicks a variant option in the segmented control
- **THEN** the selected value is passed to the preview children and the rendered component updates

#### Scenario: No variants prop
- **WHEN** LivePreview renders without a `variants` prop
- **THEN** no segmented control appears — only the preview/code tabs render

### Requirement: LivePreview wraps Ark Tabs
LivePreview SHALL use Ark Tabs (via TabGroup or directly) for preview/code tab switching, inheriting keyboard navigation and ARIA semantics.

#### Scenario: Tab switching
- **WHEN** user clicks "code" tab
- **THEN** the preview content is replaced by a SyntaxBlock showing the example code
