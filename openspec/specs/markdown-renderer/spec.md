## Markdown Renderer Specification

### Overview

A component mapping and rendering layer that renders markdown elements through the Animus showcase component library via MDX compilation. Handles headings, prose, inline code, fenced code blocks with syntax highlighting, code block input/output pairing, lists, links, blockquotes, horizontal rules, and emphasis.

### Component Mapping

The component mapping table SHALL be delivered via `MDXProvider` from `@mdx-js/react` instead of the `components` prop on `react-markdown`'s `<Markdown>` component. The mapping entries (element to Animus component) MUST remain identical.

| Markdown Element | Animus Component |
|-----------------|-----------------|
| `h1`-`h4` | `Heading` (with level and auto-id) |
| `p` | `Prose` |
| `strong` | `Strong` |
| `a` | Styled anchor |
| `blockquote` | BlockquoteWrapper |
| `ul` / `ol` | Styled list wrappers |
| `li` | Styled list item |
| `hr` | Divider |
| `table` / `th` / `td` | TableContainer / Th / Td |
| `code` (inline) | `InlineCode` |
| `code` (block, inside `pre`) | `SyntaxBlock` with language detection |

#### Scenario: All mapped elements render through ds components
- **WHEN** an MDX file contains each markdown element type
- **THEN** every element renders through the same ds component as the previous react-markdown pipeline

#### Scenario: Code block language detection preserved
- **WHEN** a fenced code block specifies ` ```tsx `
- **THEN** the `code` component receives a className or props that identify the language as `tsx`
- **AND** `SyntaxBlock` renders with correct syntax highlighting

### Code Block Rendering

#### Single code block

A fenced code block with language info string renders as `SyntaxBlock`:

````markdown
```tsx
const Button = ds.styles({ base: { px: 16 } }).build();
```
````

Renders as:
```tsx
<SyntaxBlock language="tsx" code="const Button = ds.styles({ base: { px: 16 } }).build();" />
```

#### Code block pairing (input/output)

When a code block with language `tsx`, `ts`, or `jsx` is immediately followed by a code block with language `css` (no intervening non-code sibling elements), both render as a single `CodeExample` component:

```tsx
<CodeExample
  code={{
    input: "/* content of first block */",
    output: "/* content of second block */"
  }}
  language="tsx"
/>
```

Detection is implemented as a remark plugin or a React post-processing step that inspects adjacent children.

**Non-paired blocks:** Any code block NOT matching the pairing pattern renders as standalone `SyntaxBlock`.

### Spacing

The `MarkdownContent` wrapper applies vertical spacing between rendered elements. Target spacing:
- Between headings and following content: 16px (tight)
- Between content blocks: 16px
- Between major sections (before h2): 64px
- Between code blocks and surrounding content: 24px

Spacing is applied via CSS on the wrapper targeting direct children, not via explicit `Stack` components.

### Location

```
packages/showcase/src/components/docs/MarkdownContent.tsx
```

### Dependencies

The showcase package SHALL depend on `@mdx-js/rollup`, `@mdx-js/react`, and `remark-gfm`. The `react-markdown` dependency SHALL be removed.

#### Scenario: react-markdown removed
- **WHEN** examining the showcase package.json
- **THEN** `react-markdown` is not listed as a dependency

#### Scenario: MDX dependencies present
- **WHEN** examining the showcase package.json
- **THEN** `@mdx-js/rollup`, `@mdx-js/react`, and `remark-gfm` are listed

### Extraction Compatibility

The `MarkdownContent` component itself uses Animus-styled components (Prose, Heading, SyntaxBlock, etc.) which are already extraction-compatible. The component's own wrapper styling (spacing CSS) should also use `ds.styles()` for extraction.

MDX files compile to React components at build time but contain no Animus `ds.styles()` calls themselves — they are invisible to the extraction pipeline. No changes to the Rust crate or Vite plugin are needed.

### MDX Component Provider

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

### SyntaxBlock Title Bar

SyntaxBlock SHALL accept an optional `title` prop (string). When provided, a header bar SHALL render above the code content displaying the title text in monospace font with a surface background and bottom border.

#### Scenario: Title bar rendering
- **WHEN** SyntaxBlock renders with title="button.ts"
- **THEN** a header bar appears above the code showing "button.ts" in monospace with a language indicator

#### Scenario: No title
- **WHEN** SyntaxBlock renders without a title prop
- **THEN** no header bar renders — behavior matches current implementation

### SyntaxBlock Copy Button

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

### SyntaxBlock Collapsible Mode

SyntaxBlock SHALL accept an optional `collapsible` prop (boolean, default false). When true, a collapse toggle SHALL appear in the title bar. Clicking it SHALL toggle the code content visibility. The toggle chevron SHALL rotate with CSS transition.

#### Scenario: Collapsible with title
- **WHEN** SyntaxBlock renders with collapsible={true} and title="example.ts"
- **THEN** a collapse chevron appears in the title bar; clicking it hides the code content

#### Scenario: Collapsed state
- **WHEN** the code content is collapsed
- **THEN** only the title bar is visible; the chevron rotates to indicate collapsed state

### SyntaxBlock Line Numbers

SyntaxBlock SHALL accept an optional `showLineNumbers` prop (boolean, default false). When true, line numbers SHALL render as a left-aligned column alongside each code line in dim color with right alignment and user-select: none.

#### Scenario: Line numbers enabled
- **WHEN** SyntaxBlock renders with showLineNumbers={true}
- **THEN** each line displays a line number starting at 1, right-aligned, in dim color, not selectable

#### Scenario: Line numbers disabled by default
- **WHEN** SyntaxBlock renders without showLineNumbers
- **THEN** no line numbers appear — matches current behavior

### Heading renders anchor link with icon
Heading SHALL use a lucide-react icon (`Link`, `Check`) for the anchor copy button instead of inline SVGs. Hover reveal, click-to-copy, and copied feedback behavior remain unchanged.

#### Scenario: Heading anchor icon default state
- **WHEN** Heading renders with an id
- **THEN** the anchor button contains a lucide `Link` icon that appears on hover

#### Scenario: Heading anchor icon copied state
- **WHEN** user clicks the anchor button
- **THEN** the icon changes to lucide `Check` with copied state styling

### Requirement: Heading uses CSS-only anchor hover
Heading SHALL use `_hover` selector alias on HeadingWrapper to reveal the anchor button via CSS, replacing JavaScript onMouseEnter/onMouseLeave event handlers.

#### Scenario: Anchor visibility on hover
- **WHEN** user hovers over a heading
- **THEN** the anchor button opacity SHALL transition to visible via CSS `_hover: { '& [data-anchor]': { opacity: '0.5' } }` on the wrapper
- **AND** no JavaScript event handlers SHALL be used for this behavior

### Requirement: Heading anchor uses states for copied feedback
AnchorButton SHALL use `.states({ copied })` for the copied visual feedback instead of inline style.

#### Scenario: Copy feedback via states
- **WHEN** user clicks the anchor button and the URL is copied
- **THEN** the AnchorButton SHALL receive the `copied` state prop
- **AND** the visual change (color, opacity) SHALL be applied via `@layer states` CSS

### Requirement: Heading anchor is a button element
AnchorButton SHALL be a `<button>` element instead of `<span role="button" tabIndex={0}>`.

#### Scenario: Semantic button element
- **WHEN** AnchorButton renders
- **THEN** it SHALL be an HTML `<button>` element with native keyboard handling (Enter/Space to activate)
- **AND** it SHALL include `_focusVisible` styles for keyboard focus indication

### Requirement: SyntaxBlock renders collapse toggle with icon
SyntaxBlock SHALL use a lucide-react icon (`ChevronDown` or similar) for the collapse toggle instead of an inline SVG. Rotation via `.states({ collapsed })` remains unchanged.

#### Scenario: SyntaxBlock collapse toggle icon
- **WHEN** SyntaxBlock renders with collapsible content
- **THEN** the collapse toggle displays a lucide chevron icon that rotates via the `collapsed` state

### Requirement: SyntaxBlock theme token consistency
The `animusTheme.plain.color` SHALL use `tokens.varRef('colors.text')` instead of `tokens.colors.text` for consistent CSS variable resolution.

#### Scenario: Theme uses varRef consistently
- **WHEN** the syntax theme is applied
- **THEN** all color references in the theme object SHALL use `tokens.varRef()` for CSS variable resolution

### Requirement: SyntaxBlock supports line highlighting in MDX
SyntaxBlock SHALL accept `highlights` and `diffs` props when used directly in MDX via `<SyntaxBlock>` JSX. These props enhance code examples with visual markers without changing the default rendering of standard markdown code fences.

#### Scenario: MDX author uses highlights
- **WHEN** an MDX file contains `<SyntaxBlock highlights={[3, 4]} language="tsx">{code}</SyntaxBlock>`
- **THEN** lines 3 and 4 render with amber highlight styling

#### Scenario: MDX author uses diffs
- **WHEN** an MDX file contains `<SyntaxBlock diffs={{ 2: "-", 3: "+" }} language="tsx">{code}</SyntaxBlock>`
- **THEN** line 2 shows a removal marker and line 3 shows an addition marker

#### Scenario: Standard code fences unchanged
- **WHEN** an MDX file uses triple-backtick code fences without explicit SyntaxBlock JSX
- **THEN** rendering is identical to current behavior — no highlights or diffs applied
