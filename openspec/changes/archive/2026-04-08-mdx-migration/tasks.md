## 1. Dependencies & Build Config

- [x] 1.1 Add `@mdx-js/rollup`, `@mdx-js/react`, and their type packages to `packages/showcase`; verify `remark-gfm` stays
- [x] 1.2 Remove `react-markdown` from `packages/showcase`
- [x] 1.3 Add `mdx({ remarkPlugins: [remarkGfm] })` to `vite.config.ts` plugin array, ordered before `react()`
- [x] 1.4 Replace `*.md?raw` type declaration with `*.mdx` → `ComponentType` declaration

## 2. Provider & Component Map

- [x] 2.1 Create MDX provider wrapper that supplies the existing componentMap from MarkdownContent (Heading, Prose, SyntaxBlock, InlineCode, Strong, anchor, blockquote, lists, hr, table components)
- [x] 2.2 Wire the provider into DocsLayout so all doc routes inherit the component map

## 3. Content File Migration

- [x] 3.1 Audit all 19 `.md` files for JSX-invalid syntax (unescaped `<`, `>`, `{`, `}` outside code fences/inline code) and fix
- [x] 3.2 Bulk rename all `.md` files to `.mdx`

## 4. Routing & Rendering

- [x] 4.1 Update `App.tsx` glob from `import.meta.glob('./content/**/*.md', { query: '?raw' })` to `import.meta.glob('./content/**/*.mdx')` yielding component modules
- [x] 4.2 Update DocPage rendering to mount the MDX component directly instead of passing a string to MarkdownContent
- [x] 4.3 Remove or refactor MarkdownContent — extract reusable parts (spacing styles, component map) if kept as provider wrapper, delete the react-markdown rendering path

## 5. Verification

- [x] 5.1 Build showcase (`bun run verify:showcase`) — no compile errors from MDX files
- [x] 5.2 Spot-check rendered pages: introduction, one architecture page (theming), one reference page (builder-chain), one with tables (theme-extension) — confirm visual parity with current rendering
