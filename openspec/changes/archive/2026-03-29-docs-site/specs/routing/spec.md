# Routing & Layout — Functional Spec

## Router

- React Router v7 (already installed as react-router-dom@7.13.2)
- BrowserRouter at the app root
- All routes wrapped in a shared Shell layout component via `<Outlet />`

## Route Map

| Path | Component | Loading | Description |
|------|-----------|---------|-------------|
| `/` | Home | Lazy | Landing page with pitch |
| `/docs` | Why | Lazy | Motivation and overview |
| `/docs/start` | GettingStarted | Lazy | Installation and first component |
| `/docs/concepts` | Concepts | Lazy | Builder chain, cascade, tokens |
| `/docs/api` | ApiReference | Lazy | Function and method reference |

## Layout Nesting

```
<BrowserRouter>
  <Routes>
    <Route element={<Shell />}>          ← top nav, always visible
      <Route index element={<Home />} />
      <Route path="docs" element={<DocsLayout />}>  ← sidebar, docs-only
        <Route index element={<Why />} />
        <Route path="start" element={<GettingStarted />} />
        <Route path="concepts" element={<Concepts />} />
        <Route path="api" element={<ApiReference />} />
      </Route>
    </Route>
  </Routes>
</BrowserRouter>
```

## Layout Components

### Shell
- Top-level layout wrapping all routes
- Contains: top navigation bar, `<Outlet />` for page content
- Navigation items: Home link (brand), Docs link
- Persists across all route transitions

### DocsLayout
- Nested layout for `/docs/*` routes only
- Contains: Sidebar navigation, `<Outlet />` for docs page content
- Sidebar lists all doc pages with active state highlighting
- Sidebar uses NavLink from react-router-dom for active detection

## Code Splitting Requirements

- Every page component must be lazy-loaded via `React.lazy(() => import(...))`
- Each lazy route wrapped in `<Suspense>` (no fallback required for MVP — content is small)
- Build output must produce separate JS chunks per page
- Shared components used across pages must be extracted to a common chunk by Vite automatically (no manual chunk configuration)

## Virtual CSS Module

- `virtual:animus/styles.css` imported once in main.tsx
- Single CSS file in build output regardless of JS chunk count
- All component styles available immediately (no lazy CSS loading, no FOUC)

## Navigation Behavior

- Client-side navigation between routes (no full page reloads)
- Browser back/forward must work correctly
- Direct URL access to any route must work (requires SPA fallback in hosting — already handled by Vite preview)
- Active nav state must reflect current route
