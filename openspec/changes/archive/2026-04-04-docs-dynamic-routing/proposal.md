## Why

Adding a documentation page currently requires creating 3 files: a `.md` content file, a `.tsx` wrapper component (identical 6-line boilerplate every time), and a route entry in `App.tsx`. All 18 doc page wrappers are identical — they import `MarkdownContent`, import the `.md` file with `?raw`, and return `<MarkdownContent source={content} />`. This is pure mechanical duplication that makes the docs structure harder to maintain and more error-prone to extend. Additionally, `pages/_archive/` contains 12 dead page components from prior reorgs.

Goal: adding a page = drop a `.md` file + add a nav entry in `docsNav.ts`.

## What Changes

- Replace 18 identical page wrapper components with a single `DocPage` component that resolves content dynamically using `import.meta.glob('.../*.md', { query: '?raw', eager: true })`
- Replace 18 lazy imports + manual Route definitions in `App.tsx` with route generation driven by `docsNav.ts`
- `docsNav.ts` becomes the single source of truth for both navigation AND routing
- Delete `pages/_archive/` (12 dead components from prior reorgs)
- Delete all per-page wrapper `.tsx` files in `pages/overview/`, `pages/compiler/`, `pages/architecture/`, `pages/authoring/`, `pages/advanced/`, `pages/support/`
- Flatten `content/overview/` (single file `introduction.md`) — move to `content/introduction.md`
- Non-markdown pages (`Home.tsx`, `Examples.tsx`) remain unchanged

## Capabilities

### New Capabilities
- `dynamic-doc-routing`: Convention-based content resolution from URL path to `.md` file via `import.meta.glob`. Single `DocPage` component, route tree generated from nav config.

### Modified Capabilities
<!-- No existing spec-level requirements change. The docs rendering behavior (MarkdownContent, syntax highlighting, nav) is unchanged. -->

## Impact

- **Showcase package only** — no changes to system, extract, vite-plugin, or core
- `App.tsx` — significant rewrite of docs route section (non-docs routes unchanged)
- `docsNav.ts` — may gain a content path mapping or rely on URL→file convention
- `pages/` — 18 wrapper files + 12 archive files deleted, 1 new `DocPage.tsx` created
- `content/overview/` — directory removed, `introduction.md` moved up one level
- No dependency changes — `import.meta.glob` is a Vite built-in
