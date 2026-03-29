## Context

The showcase documentation is authored as TSX with all content inline as JSX elements. A markdown rendering layer would let authors write prose as markdown files, rendered through existing Animus components at runtime. This document records the design decisions for that layer.

The showcase uses Vite 8, React 18, React Router 7, and the Animus extraction pipeline. Current dependencies include `prism-react-renderer` for syntax highlighting. No markdown tooling exists in the monorepo today.

## Goals / Non-Goals

**Goals:**
- Markdown files render through Animus components (Prose, Heading, SyntaxBlock, InlineCode) — visually identical to current TSX-authored output
- Code blocks get syntax highlighting via prism-react-renderer (already a dependency)
- Authors can write standard markdown with no custom syntax required for basic content
- Interactive demos (React state, event handlers) compose alongside markdown content without contaminating the markdown authoring experience
- Consecutive tsx/css code block pairs render as side-by-side CodeExample components
- No impact on the Animus extraction pipeline

**Non-Goals:**
- MDX support (JSX in markdown) — adds toolchain complexity for a capability we don't need. Interactive content lives in TSX companion components.
- Build-time markdown compilation — runtime parsing is adequate for docs page sizes
- Markdown-driven routing (file-system routing from .md files) — routing remains explicit in App.tsx per docs-navigation-restructure proposal
- Table of contents extraction from markdown — the right-column ToC (planned in docs-navigation-restructure) scans rendered DOM headings, not markdown AST
- Custom directive syntax (admonitions, callouts, tabs) — use TSX companion components if needed

## Decisions

### 1. `react-markdown` as the parser/renderer

Use `react-markdown` for parsing and rendering. It converts markdown to a remark AST, then renders each node as a React element via the `components` prop.

**Why not `marked`:** `marked` outputs HTML strings. To render through Animus components, we'd need `dangerouslySetInnerHTML` which bypasses React's component model. No syntax highlighting integration. No component mapping.

**Why not build-time plugin:** `vite-plugin-markdown` v3 is pre-release. The `react` output mode renders raw HTML, not mapped components. Build-time adds coupling for negligible performance gain on docs-sized content.

**Why not MDX:** MDX's value is JSX-in-markdown. We don't need JSX in markdown — interactive sections are separate TSX components composed at the page level. MDX adds `@mdx-js/rollup` + remark + rehype + MDXProvider to the dependency tree for a capability we'd explicitly avoid using.

### 2. Component mapping via a shared `componentMap` object

A single `componentMap` object maps HTML element names to Animus components. This object is defined once and shared across all `MarkdownContent` instances.

```tsx
const componentMap = {
  h1: headingFactory(1),
  h2: headingFactory(2),
  h3: headingFactory(3),
  h4: headingFactory(4),
  p: Prose,
  code: CodeRenderer,    // dispatches inline vs block
  pre: PreRenderer,      // handles code block pairing
  strong: Strong,
  a: LinkRenderer,
  blockquote: Callout,
  ul: ListRenderer,
  ol: ListRenderer,
  hr: EmberDivider,
};
```

**Why a single object:** Consistency. Every markdown page renders identically. No per-page component overrides needed. If a page needs custom rendering, it uses a TSX companion component outside the markdown flow.

### 3. Code block rendering: SyntaxBlock with language detection

Fenced code blocks (`` ```tsx ``) render as `SyntaxBlock` components with the language extracted from the info string. `SyntaxBlock` already uses `prism-react-renderer` — no new highlighting infrastructure needed.

Inline code (`` `foo` ``) renders as `InlineCode`.

The `code` component in the map dispatches between these based on whether the code is inside a `pre` element (block) or inline.

### 4. Code block pairing: consecutive tsx→css detection

When a `tsx`/`ts`/`jsx` code block is immediately followed by a `css` code block (no intervening non-code content), the rendering layer wraps both in a `CodeExample` component (side-by-side input/output display).

Implementation: a custom remark plugin or a post-render React wrapper that scans children for adjacent code blocks matching the pattern.

**Why automatic pairing over explicit syntax:** Explicit syntax (`:::example`) requires learning a custom markdown dialect. The tsx→css adjacency pattern is already the convention used in existing docs content and is unambiguous — a tsx block followed by a css block is always an input/output example in this documentation context.

**Escape hatch:** If a tsx block and css block should NOT be paired, insert any non-code element between them (a paragraph, a horizontal rule, a heading).

### 5. Vite integration: native `?raw` imports, no plugin

Markdown files are imported using Vite's built-in `?raw` query string. This returns the file content as a string at build time. No markdown-specific Vite plugin is needed.

```tsx
import content from './builder-chain.md?raw';
```

**Why `?raw` over a plugin:** Zero configuration. No plugin version compatibility concerns. The string import is tree-shakeable and works with code splitting (each page's markdown is in its own chunk). Runtime parsing by `react-markdown` is the rendering step.

**Type declaration needed:** Add a `*.md` module declaration to the project's type environment so TypeScript accepts `.md?raw` imports without errors.

### 6. Page composition: markdown + optional TSX demo

Each documentation page is a thin TSX wrapper that imports its markdown content and optionally composes it with interactive demo components.

**Pure content page** (~5 lines):
```tsx
import content from '../../content/concepts/builder-chain.md?raw';
import { MarkdownContent } from '../../components/docs/MarkdownContent';

export default function BuilderChain() {
  return <MarkdownContent source={content} />;
}
```

**Page with interactive demo** (~10 lines):
```tsx
import content from '../../content/concepts/slot-composition.md?raw';
import { MarkdownContent } from '../../components/docs/MarkdownContent';
import { SlotCompositionDemo } from '../../demos/SlotCompositionDemo';

export default function SlotComposition() {
  return (
    <>
      <MarkdownContent source={content} />
      <SlotCompositionDemo />
    </>
  );
}
```

**Why thin wrappers over direct markdown routing:** The wrapper gives us an explicit composition point for demos, metadata, or layout overrides without introducing a framework-level abstraction. Each page is a standard React component that happens to render markdown — nothing magical.

### 7. MarkdownContent component: single entry point

One component (`MarkdownContent`) is the public API for rendering markdown. It accepts a `source` string and handles parsing, component mapping, and code block pairing internally.

```tsx
interface MarkdownContentProps {
  source: string;
}
```

No other props. No component override prop. No plugin prop. If the rendering behavior needs to change, change the `componentMap` or the internal remark configuration — not the consumer API.

**Why minimal API:** This component serves one codebase (the showcase). Configurability adds API surface without adding value. If we later need different rendering for different sections, we can add it then — but we won't need to.

## Risks / Trade-offs

- **[Runtime parsing cost]** → `react-markdown` parses on every render. For docs-sized content (< 1000 lines per page), this is sub-millisecond. If it ever matters, memoize with `useMemo` keyed on the source string. Not worth optimizing preemptively.
- **[Bundle size]** → ~42 KB gzipped added. The showcase already ships 277 KB JS. This is a 15% increase in total JS for a docs-only dependency. Acceptable.
- **[Code block pairing fragility]** → Adjacent tsx→css detection could misfire if content has consecutive code blocks that aren't input/output pairs. Mitigation: the pattern is unambiguous in practice (all tsx→css adjacency in current docs IS input/output), and an escape hatch exists (insert any element between them).
- **[No JSX in markdown]** → Authors cannot embed React components inline in markdown content. This is intentional — interactive content lives in TSX companions. If this becomes a real limitation, MDX migration is additive (swap the parser, keep the component map).
- **[Loss of Stack gap control]** → Current TSX uses `<Stack gap={16}>` and `<Stack gap={64}>` for fine-grained vertical spacing. In markdown, spacing is determined by the component map (margin on headings, paragraphs, etc.). The MarkdownContent component applies consistent spacing via a wrapper. Per-element spacing control is lost but was never intentional — it was a side effect of authoring in JSX.
