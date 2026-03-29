## Markdown Renderer Specification

### Overview

A `MarkdownContent` React component that parses a markdown string and renders each element through the Animus showcase component library. Handles headings, prose, inline code, fenced code blocks with syntax highlighting, code block input/output pairing, lists, links, blockquotes, horizontal rules, and emphasis.

### Public API

```tsx
interface MarkdownContentProps {
  source: string;
}

export function MarkdownContent(props: MarkdownContentProps): JSX.Element;
```

Single prop. No configuration surface.

### Component Mapping

| Markdown Element | HTML Element | Animus Component | Notes |
|-----------------|-------------|-----------------|-------|
| `# Heading` | `h1` | `Heading level={1}` | Auto-generates `id` from text for anchor linking |
| `## Heading` | `h2` | `Heading level={2}` | Same |
| `### Heading` | `h3` | `Heading level={3}` | Same |
| `#### Heading` | `h4` | `Heading level={4}` | Same |
| Paragraph | `p` | `Prose` | Default font size and line height from component |
| `` `inline` `` | `code` (inline) | `InlineCode` | Detected by absence of parent `pre` |
| Fenced code block | `pre > code` | `SyntaxBlock` | Language from info string, syntax highlighting via prism-react-renderer |
| `**bold**` | `strong` | `Strong` | Existing component |
| `*italic*` | `em` | Native `em` or styled span | Minimal styling needed |
| `[text](url)` | `a` | Styled anchor | Internal links use React Router if applicable |
| `> blockquote` | `blockquote` | `Callout` | Existing component |
| `- list` / `1. list` | `ul` / `ol` | Styled list with Prose-consistent typography | |
| `---` | `hr` | `EmberDivider` | Existing component |
| `![alt](src)` | `img` | Native `img` with max-width constraint | Rare in docs, no custom component needed |

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

### Type Declaration

Add to the project's type environment (e.g., `src/vite-env.d.ts` or a `markdown.d.ts`):

```tsx
declare module '*.md?raw' {
  const content: string;
  export default content;
}
```

### Location

```
packages/showcase/src/components/docs/MarkdownContent.tsx
```

### Dependencies

```
react-markdown     — markdown parsing + React rendering
remark-gfm         — GitHub Flavored Markdown (tables, strikethrough, task lists)
```

Both installed in `packages/showcase` only.

### Extraction Compatibility

The `MarkdownContent` component itself uses Animus-styled components (Prose, Heading, SyntaxBlock, etc.) which are already extraction-compatible. The component's own wrapper styling (spacing CSS) should also use `ds.styles()` for extraction.

Markdown `.md` files are inert data — they contain no Animus component references and are invisible to the extraction pipeline. No changes to the Rust crate or Vite plugin are needed.
