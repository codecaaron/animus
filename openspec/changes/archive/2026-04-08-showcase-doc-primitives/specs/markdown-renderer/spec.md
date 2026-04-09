## MODIFIED Requirements

### Requirement: MDX component provider

The docs layout SHALL wrap rendered content in an `MDXProvider` that supplies the showcase component map. All standard markdown elements (headings, paragraphs, code blocks, links, lists, blockquotes, horizontal rules, tables, emphasis, strong) MUST render through the same ds-styled components as the current pipeline. The componentMap SHALL additionally include `Callout` as a custom component available without explicit import.

#### Scenario: Heading renders via component map
- **WHEN** an MDX file contains `## Section Title`
- **THEN** it renders as `<Heading level={2}>Section Title</Heading>` with auto-generated id

#### Scenario: Code fence renders via SyntaxBlock
- **WHEN** an MDX file contains a fenced code block with language `tsx`
- **THEN** it renders as `<SyntaxBlock language="tsx">` with syntax highlighting

#### Scenario: Callout available in componentMap
- **WHEN** an MDX file uses `<Callout variant="tip">content</Callout>` without explicit import
- **THEN** the Callout component renders with tip variant styling via the componentMap

## ADDED Requirements

### Requirement: SyntaxBlock title bar

SyntaxBlock SHALL accept an optional `title` prop (string). When provided, a header bar SHALL render above the code content displaying the title text in monospace font with a surface background and bottom border.

#### Scenario: Title bar rendering
- **WHEN** SyntaxBlock renders with title="button.ts"
- **THEN** a header bar appears above the code showing "button.ts" in monospace with a language indicator

#### Scenario: No title
- **WHEN** SyntaxBlock renders without a title prop
- **THEN** no header bar renders — behavior matches current implementation

### Requirement: SyntaxBlock copy button

SyntaxBlock SHALL accept an optional `copyable` prop (boolean, default true). When true, a CopyButton SHALL render in the header area (in the title bar if title is present, otherwise in a minimal overlay position). The CopyButton SHALL copy the raw code text to clipboard.

#### Scenario: Copy button present by default
- **WHEN** SyntaxBlock renders without explicit copyable prop
- **THEN** a copy button is visible in the header/overlay area

#### Scenario: Copy button copies code
- **WHEN** user clicks the copy button on a SyntaxBlock
- **THEN** the raw code text (children string) is copied to clipboard with animated feedback

#### Scenario: Copy disabled
- **WHEN** SyntaxBlock renders with copyable={false}
- **THEN** no copy button renders

### Requirement: SyntaxBlock collapsible mode

SyntaxBlock SHALL accept an optional `collapsible` prop (boolean, default false). When true, a collapse toggle SHALL appear in the title bar. Clicking it SHALL toggle the code content visibility. The toggle chevron SHALL rotate with CSS transition.

#### Scenario: Collapsible with title
- **WHEN** SyntaxBlock renders with collapsible={true} and title="example.ts"
- **THEN** a collapse chevron appears in the title bar; clicking it hides the code content

#### Scenario: Collapsed state
- **WHEN** the code content is collapsed
- **THEN** only the title bar is visible; the chevron rotates to indicate collapsed state

### Requirement: SyntaxBlock line numbers

SyntaxBlock SHALL accept an optional `showLineNumbers` prop (boolean, default false). When true, line numbers SHALL render as a left-aligned column alongside each code line in dim color with right alignment and user-select: none.

#### Scenario: Line numbers enabled
- **WHEN** SyntaxBlock renders with showLineNumbers={true}
- **THEN** each line displays a line number starting at 1, right-aligned, in dim color, not selectable

#### Scenario: Line numbers disabled by default
- **WHEN** SyntaxBlock renders without showLineNumbers
- **THEN** no line numbers appear — matches current behavior

### Requirement: Heading anchor link

The Heading component SHALL display a hover-visible anchor link icon. When the user hovers over a heading, a link icon SHALL appear. Clicking the icon SHALL copy the `#id` fragment to clipboard via CopyButton behavior and provide visual feedback.

#### Scenario: Anchor icon visibility
- **WHEN** user hovers over a Heading
- **THEN** a small link icon appears adjacent to the heading text with opacity transition

#### Scenario: Anchor click copies fragment
- **WHEN** user clicks the anchor icon on a Heading with id="slot-composition"
- **THEN** "#slot-composition" is copied to clipboard with check icon feedback
