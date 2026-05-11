## Why

The showcase docs are authored as TSX with content inlined as JSX elements. Concepts.tsx is 954 lines of `<Prose>`, `<Heading>`, `<InlineCode>`, and `<Stack gap={64}>` wrapping what is fundamentally prose and code examples. ~95% of the content is static — only one section (Slot Composition) has React state.

This creates two problems:

1. **Authoring friction.** Writing documentation means writing JSX. Every paragraph needs `<Prose fontSize={16} lineHeight="relaxed">`, every heading needs `<Heading level={2}>`, every inline code span needs `<InlineCode>`. The markup-to-content ratio is high and the feedback loop is slow.

2. **Splitting cost.** The docs-navigation-restructure proposal plans to split Concepts.tsx into 6 pages and ApiReference.tsx into 6 pages. If each page is a .tsx file with the current authoring pattern, that's 12 new files of verbose JSX for what should be simple prose + code examples.

Markdown solves both problems. `## Heading` replaces `<Heading level={2}>`. Paragraphs are just paragraphs. Code blocks are fenced. The content reads and writes like documentation.

## What Changes

- **Add a markdown rendering layer.** A component that accepts a markdown string and renders it through Animus components (Prose for `<p>`, Heading for `<h1>`-`<h6>`, SyntaxBlock for code blocks, InlineCode for inline `code`).
- **Author documentation content as `.md` files.** Each topic page in the docs-navigation-restructure becomes a `.md` file imported as a raw string. Interactive sections (live demos) remain as TSX components composed alongside the rendered markdown.
- **Define a code block convention for input/output pairs.** Code examples that show builder DSL input alongside emitted CSS output use metadata annotations on fenced code blocks to signal pairing.

## Capabilities

### New Capabilities
- `markdown-renderer`: A React component that parses markdown and renders each element through the existing Animus component library. Handles: headings (h1-h6), paragraphs, inline code, code blocks with syntax highlighting, lists, strong/em, links, blockquotes, horizontal rules.
- `code-block-pairing`: A convention and rendering behavior for pairing consecutive code blocks as input/output examples. Uses code block meta annotations or a language-suffix convention to signal that adjacent blocks form a pair rendered as a CodeExample component.
- `md-content-import`: `.md` files imported via Vite's `?raw` query string, parsed and rendered at runtime. No additional Vite plugins required.

### Modified Capabilities
- `developer-knowledge-docs`: Documentation content migrates from inline JSX to markdown files. Visual output and component styling remain identical — only the authoring format changes.

## Impact

- **Dependencies:** One new dependency — a markdown parser. Options evaluated below.
- **Extraction pipeline:** No impact. Markdown files contain no Animus components. The rendering layer (TSX) uses Animus components that extraction already processes. The `.md` files are data, not code.
- **Vite config:** No changes. Vite natively supports `?raw` imports. No new plugins needed.
- **Component library:** No new components. The rendering layer maps markdown elements to existing components (Prose, Heading, SyntaxBlock, InlineCode, etc.).
- **Interactive content:** Sections that require React state (live demos, toggles) remain as TSX components. A page can compose rendered markdown + TSX demo components in the same layout.

## Options Considered

### Option A: `react-markdown` + component mapping (Recommended)

Parse markdown at runtime using `react-markdown`, which converts markdown AST nodes directly to React elements. Component mapping is built-in via the `components` prop.

```tsx
import content from './builder-chain.md?raw';

<MarkdownContent source={content} />
// internally:
// <ReactMarkdown components={componentMap}>{source}</ReactMarkdown>
```

**Component map:**
```tsx
const componentMap = {
  h1: (props) => <Heading level={1} {...props} />,
  h2: (props) => <Heading level={2} {...props} />,
  h3: (props) => <Heading level={3} {...props} />,
  p:  (props) => <Prose {...props} />,
  code: ({ inline, className, children }) =>
    inline
      ? <InlineCode>{children}</InlineCode>
      : <SyntaxBlock language={extractLang(className)} code={String(children)} />,
  // ...
};
```

- Bundle: ~42 KB gzipped (react-markdown + unified/remark/rehype)
- Pros: React-idiomatic, component mapping is first-class, remark/rehype plugin ecosystem
- Cons: Runtime parsing (negligible for docs pages), heavier than `marked`

### Option B: `marked` + `dangerouslySetInnerHTML` + CSS targeting

Parse markdown to HTML string. Render via `dangerouslySetInnerHTML`. Style output via CSS selectors targeting standard HTML elements within a wrapper class.

- Bundle: ~12 KB gzipped
- Pros: Smallest bundle, simplest integration
- Cons: No component mapping — styles are CSS-only, not Animus components. Loses SyntaxBlock (no prism highlighting). `dangerouslySetInnerHTML` bypasses React's rendering model.

### Option C: Build-time Vite plugin

Use `vite-plugin-markdown` (v3 pre-release) to compile `.md` imports to React components at build time.

- Bundle: 0 KB runtime (compiled away)
- Pros: Zero runtime cost, build-time optimization
- Cons: Plugin is pre-release for Vite 8, limited component mapping support, adds build-time coupling

### Recommendation: Option A

`react-markdown` is the right tool because:
1. Component mapping is the core requirement — every markdown element renders through an Animus component, maintaining visual consistency and extraction compatibility.
2. 42 KB is negligible for a docs site that already ships 277 KB JS.
3. The remark plugin ecosystem enables future extensions (GFM tables, custom directives) without building custom parsers.
4. Runtime parsing cost is unmeasurable on modern hardware for the document sizes we have.

## Authoring Experience

**Before (TSX):**
```tsx
<Stack gap={16}>
  <Heading level={2}>The Builder Chain</Heading>
  <Prose fontSize={16} lineHeight="relaxed">
    Every component starts with <InlineCode>animus(element)</InlineCode> and
    builds up through a typed method chain. Each method adds a layer to the
    component's cascade.
  </Prose>
  <CodeExample code={builderChainExample} language="tsx" />
</Stack>
```

**After (Markdown):**
```markdown
## The Builder Chain

Every component starts with `animus(element)` and builds up through a typed
method chain. Each method adds a layer to the component's cascade.

\`\`\`tsx
const Button = ds
  .styles({ base: { px: 16, py: 8 } })
  .variants({ size: { sm: { px: 8 }, lg: { px: 24 } } })
  .build();
\`\`\`
```

**Page wrapper (TSX) for mixed content:**
```tsx
import content from './builder-chain.md?raw';

export default function BuilderChain() {
  return (
    <Stack gap={64}>
      <MarkdownContent source={content} />
    </Stack>
  );
}
```

**Page with interactive demo:**
```tsx
import content from './slot-composition.md?raw';
import { SlotCompositionDemo } from '../demos/SlotCompositionDemo';

export default function SlotComposition() {
  return (
    <Stack gap={64}>
      <MarkdownContent source={content} />
      <SlotCompositionDemo />
    </Stack>
  );
}
```

## Code Block Convention

### Single code block
Standard fenced code with language:
````markdown
```tsx
const Button = ds.styles({ base: { px: 16 } }).build();
```
````
Renders as `SyntaxBlock` with language-appropriate highlighting.

### Input/Output pair
Two consecutive fenced code blocks where the second has language `css` or a `// output` comment on the first line. The rendering layer detects adjacent code blocks and optionally pairs them as a `CodeExample` component.

````markdown
```tsx
const Button = ds
  .styles({ base: { px: 16, py: 8, bg: 'primary' } })
  .build();
```

```css
/* Emitted CSS */
.btn_base { padding: 16px 8px; background: var(--colors-primary); }
```
````

The pairing heuristic: a `tsx`/`ts` block immediately followed by a `css` block renders as `CodeExample` (side-by-side). All other code blocks render as standalone `SyntaxBlock`.

## Prerequisite Relationship

This proposal is a **prerequisite** to `docs-navigation-restructure`. The navigation proposal plans to split Concepts.tsx into 6 files and ApiReference.tsx into 6 files. If those files are `.md` instead of `.tsx`, authoring the split is dramatically simpler and the resulting files are easier to maintain.

Implement this first, then proceed with the navigation restructure where each topic page is a `.md` file with an optional TSX wrapper for interactive demos.

## File Organization (Preview)

After both proposals are implemented:
```
src/
  content/
    concepts/
      builder-chain.md
      cascade-contract.md
      design-tokens.md
      responsive-props.md
      variants-states.md
      slot-composition.md        ← has companion demo
    api/
      create-theme.md
      create-system.md
      builder-chain.md
      create-transform.md
      prop-groups.md
      vite-plugin.md
    why.md
    getting-started.md
  demos/
    SlotCompositionDemo.tsx      ← interactive React components
  pages/
    concepts/
      BuilderChain.tsx           ← thin wrapper: import md + MarkdownContent
      SlotComposition.tsx        ← wrapper: md + demo component
      ...
```

The `pages/` TSX wrappers are thin — typically 5-10 lines importing the markdown content and composing it with any interactive demos. The bulk of authoring happens in `content/` as plain markdown.
