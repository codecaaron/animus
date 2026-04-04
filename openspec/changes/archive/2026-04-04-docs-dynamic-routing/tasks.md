## 1. Content directory cleanup

- [x] 1.1 Move `content/overview/introduction.md` to `content/introduction.md`
- [x] 1.2 Delete empty `content/overview/` directory
- [x] 1.3 Rename `content/getting-started.md` to `content/start.md` (match URL path `/docs/start`)

## 2. Content resolver + DocPage component

- [x] 2.1 Create `import.meta.glob` content map with `eager: true` and `?raw` query
- [x] 2.2 Write `resolveContentPath(contentKey: string)` — maps URL segment to glob key, with index special case
- [x] 2.3 Write `DocPage` component — resolves content key → raw markdown → `<MarkdownContent source={...} />`

## 3. Route generation from nav config

- [x] 3.1 Write `generateDocRoutes(nav: NavEntry[], contentModules)` — walks `DOCS_NAV`, produces `<Route>` elements
- [x] 3.2 Handle section entries: parent `<Route>` with index `<Navigate>` to first child
- [x] 3.3 Handle leaf entries: `<Route>` with `<DocPage contentKey={...} />`

## 4. App.tsx rewrite

- [x] 4.1 Remove all 18 lazy imports for doc page wrappers
- [x] 4.2 Replace manual docs route tree with `generateDocRoutes()` call
- [x] 4.3 Verify non-docs routes (Home, Examples, NotFound) are unchanged

## 5. Dead code removal

- [x] 5.1 Delete `pages/_archive/` directory (12 files)
- [x] 5.2 Delete `pages/overview/`, `pages/compiler/`, `pages/architecture/`, `pages/authoring/`, `pages/advanced/`, `pages/support/` (18 wrapper files)
- [x] 5.3 Delete `pages/GettingStarted.tsx`
- [x] 5.4 Delete `pages/reference/` (4 wrapper files — BuilderChain, CreateTheme, CreateSystem, Compose)

## 6. Verification

- [x] 6.1 `bun run build` in showcase — confirm clean build (589ms, 352 modules)
- [ ] 6.2 Spot-check: all 18 nav entries render correct content (dev server or build output)
- [x] 6.3 Confirm no `.tsx` wrapper files remain for doc pages
