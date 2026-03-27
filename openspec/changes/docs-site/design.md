## Context

The showcase package is a single-page demo app with 28 Animus components, no routing, and no code splitting. It serves as an extraction pipeline proof but provides no consumer documentation. The extraction pipeline has been verified with code splitting (session 18: Vite correctly produces separate lazy chunks + shared component chunks + single CSS file).

React Router v7 is already installed (`react-router-dom@7.13.2`). A minimal router with Shell layout, lazy Home page, and lazy Docs placeholder is already wired and builds successfully.

Current build output with routing:
```
index.js        204.10 kB  — framework (react, router, runtime)
components.js   104.25 kB  — shared component chunk
Home.js           8.12 kB  — lazy route
Docs.js           1.79 kB  — lazy route
index.css        15.59 kB  — single CSS file (all extracted CSS)
```

## Goals / Non-Goals

**Goals:**
- 5-page docs site that teaches Animus usage (Home, Why, Getting Started, Concepts, API Reference)
- Stress test code splitting, lazy routes, color mode toggling, and shared component chunks
- Dogfood Animus components for all docs site UI (nav, sidebar, headings, tables, code blocks)
- Accurate API documentation reflecting the actual codebase (7-layer cascade, `.compound()`, `.extend()`, prop group composition)

**Non-Goals:**
- Visual/graphic design (deferred to frontend-design skill)
- Interactive playground or live code editor
- Search, versioning, blog, or changelog
- Mobile-optimized responsive layout (responsive props used but not a design target)
- Production hosting configuration

## Decisions

### 1. BrowserRouter over createBrowserRouter

**Decision**: Use `<BrowserRouter>` with JSX route definitions.

**Why**: 5-page docs site with no loaders, actions, or complex data fetching. `createBrowserRouter` unlocks features we don't need (route loaders, `<ScrollRestoration>` component) at the cost of a different API shape. Scroll restoration is handled with a simple `useEffect` on pathname.

**Alternative considered**: `createBrowserRouter` + `RouterProvider` — rejected as over-engineering for the current scope.

### 2. Per-route Suspense boundaries (not centralized)

**Decision**: Each lazy route is wrapped in its own `<Suspense>` at the route definition level.

**Why**: Keeps the DocsLayout sidebar visible during page transitions. Only the content area suspends. If Suspense were centralized in DocsLayout wrapping `<Outlet />`, the sidebar would also disappear during loading.

### 3. Wrapper function pattern for polymorphic components (Heading, List)

**Decision**: Heading and List are wrapper function components around builder-chain styled primitives, not pure builder-chain exports.

**Why**: Two concerns require runtime logic that builder chains can't express:
- Element polymorphism: Heading renders `<h2>` or `<h3>` — variants control CSS classes, not HTML elements. The `as` prop on the underlying primitive handles element swapping.
- Runtime id generation: Heading computes an `id` from children text content for anchor linking.

This is the same pattern used by SyntaxBlock (wraps SyntaxPre with language/highlighting logic).

**Alternative considered**: Two separate components (`H2`, `H3`) — rejected because it fragments the API and loses the level abstraction.

### 4. Table as composition primitives (not data-driven)

**Decision**: Table is three builder-chain components (`TableContainer`, `Th`, `Td`) composed by page code, not a single data-driven component.

**Why**: Consistent with Animus's primitive composition model. Data-driven tables (`<Table columns={...} rows={...} />`) are convenient but inflexible when cells contain mixed content (InlineCode, links, emphasis). Composition handles this naturally.

### 5. ColorModeToggle: two-part implementation

**Decision**: Split into (1) a React component for the toggle button and (2) a blocking `<script>` in index.html for initialization.

**Why**: React components render after hydration, which is after first paint. Reading localStorage and setting `data-color-mode` must happen before CSS is parsed to prevent flash of wrong color mode. The blocking script runs synchronously in `<head>`.

### 6. CodeExample uses its own container (not CodeFrame)

**Decision**: CodeExample wraps SyntaxBlock instances in a neutral container, not the existing CodeFrame component.

**Why**: CodeFrame has a decorative gradient `::before` pseudo-element with animation — appropriate for the showcase's editorial aesthetic but inappropriate for neutral docs code display.

### 7. Prop groups documented as composable building blocks

**Decision**: Document the raw group exports (`color`, `flex`, `grid`, etc.) as building blocks, and show how `.addGroup()` composes them into named groups (`surface`, `arrange`, etc.).

**Why**: The raw exports and the composed groups are two different levels of abstraction. Previous spec drafts conflated them, listing `color` group props as if they were the group a developer references in `.groups()`. The developer actually creates their own group names via `.addGroup('surface', { ...color, ...border, ...shadows })`.

## Risks / Trade-offs

**[Risk] Docs content accuracy may drift from codebase** → Mitigated by the review process that cross-referenced specs against actual source. Code examples in docs are static strings — they won't break if the API changes, but they also won't auto-update. Manual review needed when API changes.

**[Risk] Single CSS file grows with every new component** → Acceptable for a 5-page docs site. Current CSS is 15.59 KB. Adding 7 new components will add ~1-2 KB. At scale (100+ components), this becomes a concern — but that's a future architecture decision (CSS code splitting), not an MVP concern.

**[Risk] `bun run` subprocess dependency** → The vite-plugin's subprocess model requires `bun` on PATH. All three subprocesses (system load, global styles, transform resolution) use `bun run`. This is an existing constraint, not introduced by this change, but docs should note it in the Getting Started prerequisites.

**[Trade-off] No Suspense fallback** → Pages are 1-8 KB. On fast connections, loading is invisible. On slow connections, the content area collapses briefly. Accepted for MVP — not worth adding loading UI for sub-frame load times.
