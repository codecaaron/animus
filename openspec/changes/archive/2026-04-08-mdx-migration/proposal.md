## Why

The showcase docs are raw `.md` files rendered via `react-markdown` as strings. This means documentation pages cannot embed live React components — every interactive example must live on the separate `Examples.tsx` page, creating a structural split between "where you read about a pattern" and "where you see it work." MDX compiles markdown files as React components, letting code fences coexist with live `<Button>`, `<Card>`, and `<Tooltip>` instances in the same page. This is the infrastructure prerequisite for decomposing the monolithic Examples page and building inline pattern demos.

## What Changes

- Replace `react-markdown` string rendering pipeline with `@mdx-js/rollup` compiled module pipeline
- Add MDX Vite plugin to showcase build, alongside existing `animusExtract` (orthogonal — MDX imports components, doesn't define ds chains)
- Create MDXProvider wrapper reusing the existing componentMap (Heading, Prose, SyntaxBlock, InlineCode, Strong, table components, etc.)
- Bulk rename all 19 `.md` content files to `.mdx`, fixing any JSX-invalid syntax (unescaped `<`, `{`, `>` in prose)
- Update `App.tsx` glob from `import.meta.glob('?raw')` string loading to module imports that yield React components
- Update `DocsLayout` / doc page rendering to mount MDX components instead of passing strings to `<Markdown>`
- Remove `react-markdown` dependency (replaced entirely)
- Retain `remark-gfm` (used by `@mdx-js/rollup` for tables, strikethrough, task lists)

## Capabilities

### New Capabilities

- `mdx-authoring`: The ability to import and render live React components inline within documentation pages. Includes MDX compilation pipeline, provider configuration, and content file format.

### Modified Capabilities

- `markdown-renderer`: Rendering engine changes from `react-markdown` (string → React) to MDX (compiled module → React). Same component mapping, different delivery mechanism. The `MarkdownContent` component either adapts to accept a component instead of a string, or is replaced by a provider-based approach.

## Impact

- **Packages affected:** `packages/showcase` only — no system/extract/plugin changes
- **Dependencies:** Add `@mdx-js/rollup`, `@mdx-js/react`. Remove `react-markdown`. Keep `remark-gfm`.
- **Build pipeline:** New Vite plugin in showcase config. No interaction with `animusExtract`.
- **Content files:** All 19 `.md` → `.mdx`. Prose content unchanged, syntax escaping only.
- **Routing:** `DOCS_NAV` unchanged. Glob pattern and import mechanism change.
- **Type declarations:** `*.md?raw` module declaration replaced with `*.mdx` module declaration.
