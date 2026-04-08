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
