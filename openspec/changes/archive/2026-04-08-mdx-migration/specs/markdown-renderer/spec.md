## MODIFIED Requirements

### Requirement: Component Mapping

The component mapping table SHALL be delivered via `MDXProvider` from `@mdx-js/react` instead of the `components` prop on `react-markdown`'s `<Markdown>` component. The mapping entries (element → Animus component) MUST remain identical.

| Markdown Element | Animus Component |
|-----------------|-----------------|
| `h1`–`h4` | `Heading` (with level and auto-id) |
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

### Requirement: Dependencies

The showcase package SHALL depend on `@mdx-js/rollup`, `@mdx-js/react`, and `remark-gfm`. The `react-markdown` dependency SHALL be removed.

#### Scenario: react-markdown removed
- **WHEN** examining the showcase package.json
- **THEN** `react-markdown` is not listed as a dependency

#### Scenario: MDX dependencies present
- **WHEN** examining the showcase package.json
- **THEN** `@mdx-js/rollup`, `@mdx-js/react`, and `remark-gfm` are listed

## REMOVED Requirements

### Requirement: Raw string source rendering

The `MarkdownContent` component previously accepted a `source: string` prop containing raw markdown text. This interface is removed.

**Reason:** MDX files are compiled to React components at build time. There is no runtime markdown string to parse.

**Migration:** Content is rendered by mounting the MDX component directly, not by passing a string to a renderer.
