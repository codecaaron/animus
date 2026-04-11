## ADDED Requirements

### Requirement: BeforeAfter split view
The system SHALL provide a BeforeAfter component that displays two code panes side-by-side with labeled headers, demonstrating input source → output result transformations.

#### Scenario: Rendering a before/after extraction example
- **WHEN** BeforeAfter is rendered with `before` (code string + label) and `after` (code string + label) props
- **THEN** two SyntaxBlocks appear in a 1fr 1fr grid, each with a pane header showing the label, filename, and a status tag

#### Scenario: Pane headers distinguish input from output
- **WHEN** the component renders
- **THEN** the left pane header shows a muted label with a "runtime" tag, and the right pane header shows a green-tinted label with an "extracted" tag

#### Scenario: Embedded SyntaxBlocks suppress their own borders
- **WHEN** SyntaxBlocks render inside BeforeAfter
- **THEN** they render with `bordered={false}` since the outer container provides the shared border

#### Scenario: Language detection per pane
- **WHEN** before and after panes have different languages (e.g., TSX input, CSS output)
- **THEN** each SyntaxBlock receives its own language prop for correct highlighting

### Requirement: MetricCard stat grid
The system SHALL provide a MetricCard component for displaying key statistics with large formatted numbers, labels, and optional delta badges.

#### Scenario: Rendering a 3-up metric grid
- **WHEN** three MetricCards are placed inside a MetricGrid
- **THEN** they render in a 3-column grid with consistent spacing

#### Scenario: Metric value with unit suffix
- **WHEN** a MetricCard has value "0" and unit "kb"
- **THEN** the value renders in large mono font with the unit in smaller, dimmer text beside it

#### Scenario: Delta badge indicates improvement
- **WHEN** a MetricCard has a delta prop with kind "good"
- **THEN** a green-tinted badge renders below the label showing the delta text

### Requirement: BundleBar comparison chart
The system SHALL provide a BundleBar component for horizontal bar charts comparing sizes or quantities across categories.

#### Scenario: Rendering comparative bars
- **WHEN** BundleBar receives an array of items with label, value text, percentage, and category
- **THEN** each item renders as a row: right-aligned label, background track, and colored fill at the given percentage width

#### Scenario: Fill color varies by category
- **WHEN** an item has category "runtime", "extracted", or "static"
- **THEN** the fill bar uses the corresponding color (accent, teal, blue respectively)

#### Scenario: Fill width animates on mount
- **WHEN** the component mounts
- **THEN** fill bars transition from 0% to their target width with a cubic-bezier easing
