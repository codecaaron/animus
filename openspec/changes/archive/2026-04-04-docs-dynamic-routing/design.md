## Context

The showcase docs site has 18 routable markdown pages across 8 sections. Every page uses an identical 6-line `.tsx` wrapper that imports `MarkdownContent` and a `.md?raw` file. `App.tsx` has 18 corresponding `lazy()` imports and ~200 lines of manual `<Route>` elements. `docsNav.ts` independently defines the same structure for sidebar navigation.

Three files must stay in sync to add one page. The wrappers carry zero logic — they exist only because React Router needs a component and Vite needs an import statement.

### Current file count
- 18 content `.md` files in `content/`
- 18 wrapper `.tsx` files in `pages/` subdirectories (+ 12 dead files in `pages/_archive/`)
- 1 `App.tsx` with 18 lazy imports + route tree
- 1 `docsNav.ts` with nav structure

### Constraints
- Non-docs pages (`Home.tsx`, `Examples.tsx`) are custom React components — they stay manual
- `MarkdownContent` component is unchanged — it takes `{ source: string }` and renders via react-markdown
- The 4 reference pages (`BuilderChain`, `CreateTheme`, `CreateSystem`, `Compose`) are also identical wrappers — they get the same treatment

## Goals / Non-Goals

**Goals:**
- Adding a doc page = 1 `.md` file + 1 nav entry in `docsNav.ts`
- Single source of truth: `docsNav.ts` drives both navigation and routing
- Delete all boilerplate wrapper components and archive files
- Flatten single-file content directories where the directory adds no information

**Non-Goals:**
- File-system routing (would require a Vite plugin like vite-plugin-pages — overkill for 18 pages)
- Auto-generating nav from file structure (nav ordering and labels need to be explicit)
- Changing MarkdownContent, the markdown rendering pipeline, or any styling
- Changing non-docs routes (Home, Examples)

## Decisions

### 1. Content resolution: URL path convention

**Decision:** Derive the `.md` file path from the URL path by convention.

URL `/docs/authoring/base-styling` → content file `content/authoring/base-styling.md`

The glob `import.meta.glob('../content/**/*.md', { query: '?raw', eager: true })` returns a record keyed by relative file path. Strip the prefix/suffix to get a content key, match it against the URL path segment after `/docs/`.

**Special case:** The docs index route (`/docs`) maps to `content/introduction.md` (after flattening `content/overview/`). This is one hard-coded mapping in the content resolver.

**Why not add a `content` field to NavItem?** Convention is simpler and keeps the nav config focused on display concerns. The one special case (index) doesn't justify adding a field to every entry.

### 2. Eager glob loading

**Decision:** Use `eager: true` to load all `.md` content at build time.

```ts
const contentModules = import.meta.glob('../content/**/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
```

**Trade-off:** Currently each page is a separate lazy chunk. With eager loading, all ~180KB of raw markdown text lands in one chunk. This is acceptable because:
- The text compresses well (gzip ~30-40KB)
- `react-markdown` + `remarkGfm` are already in the shared chunk (used by every page)
- Instant page transitions are better UX for a docs site than loading spinners
- The showcase is a dev/docs tool, not a public-facing product site where every KB matters

**Alternative considered:** `eager: false` returns `() => Promise<string>`, preserving code splitting. But this requires Suspense boundaries, loading states, and more complex component logic — all to save ~30KB gzipped on initial load of a docs site. Not worth it.

### 3. Route generation from nav config

**Decision:** A utility function walks `docsNav.ts` and generates `<Route>` elements.

```
docsNav entry with path "/docs/authoring/base-styling"
  → Route path="base-styling" element={<DocPage contentKey="authoring/base-styling" />}
```

Sections with children get a parent `<Route path="section">` with an index redirect to the first child (preserving current behavior).

`App.tsx` replaces ~200 lines of manual routes with a single `{generateDocRoutes(DOCS_NAV, contentModules)}` call inside the docs layout route.

### 4. Single DocPage component

**Decision:** One component replaces all 18 wrappers:

```tsx
function DocPage({ contentKey }: { contentKey: string }) {
  const content = contentModules[resolveContentPath(contentKey)];
  if (!content) return <NotFound />;
  return <MarkdownContent source={content} />;
}
```

This lives in `App.tsx` or a small utility file — it's ~5 lines, not worth a separate module.

### 5. Directory flattening

**Decision:** Flatten `content/overview/` → move `introduction.md` to `content/introduction.md`. The `overview/` directory contained a single file and the URL path is `/docs` (index), not `/docs/overview/introduction`, so the directory added no structural information.

`content/support/` stays as-is — it maps to the URL segment `/docs/support/troubleshooting` and may gain siblings.

### 6. GettingStarted.tsx

**Decision:** `GettingStarted.tsx` is also an identical wrapper (`content/getting-started.md?raw`). It gets the same treatment — deleted, content resolved dynamically. The nav entry path `/docs/start` maps to content key `getting-started` — this is the second convention exception alongside the index route.

Actually, we can make this cleaner: rename the content file to `content/start.md` to match the URL path. Then NO special cases except the index route.

## Risks / Trade-offs

- **Bundle size increase (~30KB gzip):** All markdown content loads eagerly instead of per-page chunks. Acceptable for a docs site. If the content grows significantly (50+ pages), revisit lazy loading.  → Mitigation: monitor bundle size in CI.

- **Lost lazy loading for MarkdownContent itself:** Currently each page lazy-imports its wrapper, which pulls in MarkdownContent. With eager content, MarkdownContent moves to the main chunk. → Mitigation: MarkdownContent + react-markdown are already effectively shared across all doc routes; Vite likely hoists them anyway.

- **Content key mismatches:** If a nav path doesn't match a content file, the page silently shows NotFound. → Mitigation: the route generator can warn at dev time if a nav entry has no matching content file. Or a build-time check.
