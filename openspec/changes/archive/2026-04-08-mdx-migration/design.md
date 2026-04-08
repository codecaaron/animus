## Context

The showcase app renders 19 documentation pages from `.md` files loaded as raw strings via `import.meta.glob('./content/**/*.md', { query: '?raw' })`. The `MarkdownContent` component passes each string to `react-markdown` with `remarkGfm` and a component map that routes every HTML element to a ds-styled component (Heading, Prose, SyntaxBlock, InlineCode, etc.).

This pipeline cannot embed live React components in doc pages. Interactive examples are confined to `Examples.tsx` — the only non-markdown page in the docs tree.

## Goals / Non-Goals

**Goals:**
- Replace the string-based markdown pipeline with compiled MDX modules
- Preserve all existing component mappings and rendering behavior
- Enable future inline component demos in doc pages (the capability, not the content)
- Clean swap: after migration, all 19 pages render identically to current state

**Non-Goals:**
- Adding live component demos to doc pages (follow-on change)
- Decomposing Examples.tsx (follow-on)
- Creating new pages (style guide, pattern pages — follow-on)
- Changing any prose content
- Modifying the Animus extraction pipeline

## Decisions

### 1. MDX compilation via `@mdx-js/rollup`

The Vite-compatible MDX compiler. Added as a Vite plugin in `vite.config.ts` alongside `react()` and `animusExtract()`.

Configuration:
```typescript
import mdx from '@mdx-js/rollup';
import remarkGfm from 'remark-gfm';

plugins: [
  mdx({ remarkPlugins: [remarkGfm] }),
  react(),
  animusExtract({ system: './src/ds.ts' }),
]
```

`mdx()` MUST be listed before `react()` — it compiles `.mdx` → JSX, then React's plugin handles the JSX. Order matters.

**Why not `@mdx-js/esbuild`?** Vite uses Rollup in production and esbuild for dev transforms, but `@mdx-js/rollup` works in both modes via Vite's plugin compat layer. It's the documented approach.

### 2. Component mapping via `@mdx-js/react` provider

The existing `componentMap` in `MarkdownContent.tsx` transfers to an `MDXProvider`:

```tsx
import { MDXProvider } from '@mdx-js/react';

// Same mapping table, different delivery
<MDXProvider components={componentMap}>
  <Outlet />
</MDXProvider>
```

The provider wraps the docs layout so all MDX pages inherit the mapping. Individual MDX files can override or extend components via their own exports.

**Alternative considered:** Passing components as props to each MDX module at render time. Rejected — provider is cleaner for a shared mapping across 19 pages.

### 3. Content glob changes from `?raw` strings to module imports

Current:
```typescript
const contentModules = import.meta.glob('./content/**/*.md', {
  query: '?raw',
  import: 'default',
}) as Record<string, () => Promise<string>>;
```

After:
```typescript
const contentModules = import.meta.glob('./content/**/*.mdx', {
  import: 'default',
}) as Record<string, () => Promise<ComponentType>>;
```

Each MDX file is now a lazy-imported React component. The `DocPage` component renders it directly instead of passing a string to `<MarkdownContent>`.

### 4. MarkdownContent becomes MDXProvider wrapper or is removed

Two options:
- **Option A:** Keep `MarkdownContent` as the provider wrapper (rename to `MDXWrapper` or similar) — it sets up the provider context and applies the content-area spacing styles.
- **Option B:** Inline the provider into `DocsLayout` and delete `MarkdownContent`.

Option A is cleaner — the spacing CSS and provider are co-located, `DocsLayout` stays layout-only.

### 5. JSX-invalid syntax escaping in content files

MDX interprets `{`, `}`, `<`, `>` as JSX. Prose that uses these literally (e.g., "the `<Button>` component" or "values like `{colors.primary}`) must be escaped or wrapped in backtick code spans (which are already the convention in most files).

Audit each file for unescaped instances. Most will already be in code fences or inline code — the main risk is bare angle brackets in prose.

### 6. Type declarations

Replace:
```typescript
declare module '*.md?raw' {
  const content: string;
  export default content;
}
```

With:
```typescript
declare module '*.mdx' {
  import type { ComponentType } from 'react';
  const MDXComponent: ComponentType;
  export default MDXComponent;
}
```

## Risks / Trade-offs

**[Risk] MDX compile errors from existing content** → Audit all 19 files for JSX-invalid syntax before renaming. Fix in the same commit as the rename.

**[Risk] Code fence rendering changes** → MDX handles code fences natively. Verify that the `code` component mapping still receives `className="language-xxx"` for language detection. Test with tsx, css, typescript, and sh code blocks.

**[Risk] `animusExtract` plugin interaction** → Low risk. The extract plugin scans for `ds.styles()` chains in `.ts`/`.tsx` files. MDX files won't contain chain definitions (they import already-extracted components). If the plugin's file filter excludes `.mdx` by extension, no issue. If it inadvertently scans `.mdx`, the scanner finds no chains and moves on.

**[Trade-off] Build time increase** → MDX compilation adds a transform step per file. For 19 small files this is negligible. Monitor if file count grows significantly.

**[Trade-off] Authoring DX shift** → Authors must know JSX escaping rules. Mitigated by the fact that most special characters already appear in code fences or inline code spans.
