## Context

Showcase (`packages/showcase/`) proves Vite extraction end-to-end: 22 components, 8 color modes, zero Emotion runtime. It exercises every extraction behavior. But it's Vite-specific — `animusExtract()` plugin, `virtual:animus/styles.css`, Vite's dev server HMR.

The `next-webpack-plugin` needs its own proof. The test app must be minimal (fast CI builds) but cover enough extraction behaviors to catch real bugs. It must exercise both rendering models Next.js offers: App Router (RSC) and Pages Router (SSR).

## Goals / Non-Goals

**Goals:**
- Verify extraction pipeline works through webpack (not Vite)
- Cover both App Router (server + client components) and Pages Router in one app
- Exercise the behavioral taxonomy: base, variants, states, system props, composition, transforms
- Provide post-build assertions runnable in CI
- Stay minimal — build time under 30s, ~6-8 components

**Non-Goals:**
- Visual design or design system showcase (this is a test fixture)
- Multiple color modes (1 mode is sufficient to prove token resolution)
- Complex typography, animations, or decorative components
- Performance benchmarking
- E2E browser testing (post-build grep assertions are sufficient initially)

## Decisions

### 1. Single app, dual router

**Decision:** One Next.js app with both `app/` and `pages/` directories.

**Rationale:** Next.js supports this natively. The webpack plugin runs identically for both routers — same `analyzeProject()` call, same `transformFile()` per source file. The difference is rendering model:
- `app/` components are RSC by default (server-rendered, no hydration unless `"use client"`)
- `pages/` components use getServerSideProps/getStaticProps (SSR + hydration)

Testing both in one app proves the plugin doesn't break either model. One `next build` exercises everything.

### 2. Theme: minimal but real

**Decision:** 3 scales (colors, space, fontSizes) + 1 color mode + breakpoints. Enough to verify scale resolution, CSS variable emission, and responsive extraction.

No `addContextualVars` (tested in integration suite already). No custom `addScale({ emit: true })` beyond colors. Keeps the fixture focused.

### 3. Component fixtures by behavior, not by visual role

**Decision:** Each component targets a specific extraction behavior, named accordingly.

| Component | Behavior tested | Builder chain |
|-----------|----------------|---------------|
| `Box` | Base styles + system props | `.styles().system({ space: true, layout: true }).asElement('div')` |
| `Button` | Variants + states | `.styles().variant(size, intent).states(hover, disabled).asElement('button')` |
| `Card` | Transforms | `.styles().variant(elevation: size transform).asElement('div')` |
| `Stack` | Responsive system props | `.styles().system({ space: true }).asElement('div')` with responsive JSX |
| `Badge` | Compound variants | `.styles().variant(size, intent).compound(...).asElement('span')` |
| `Family` | Composition | `compose({ Root, Child }, { shared: { size: true } })` |

6 components covering 7 behaviors: base, variants, states, system props, composition, compounds, transforms.

### 4. Page structure

```
app/
  layout.tsx          — Root layout, imports .animus/styles.css
  page.tsx            — RSC page: renders Box, Button, Card, Stack (server component, no "use client")
  client/
    page.tsx          — Client page: "use client", interactive variant toggling via useState

pages/
  legacy.tsx          — Pages Router page: renders same components, proves SSR extraction
  _app.tsx            — Custom App, imports .animus/styles.css
```

**Shared imports:** Button and Box used by both `app/page.tsx` and `pages/legacy.tsx`. If extraction produces inconsistent class names or missing CSS for either router, the build or assertions catch it.

### 5. Post-build assertions

Shell script matching showcase's `assert-showcase.sh` pattern:

```bash
# CSS output contains @layer declarations
grep -q '@layer base' .next/static/css/*.css
grep -q '@layer variants' .next/static/css/*.css

# Class names follow animus- pattern
grep -rq 'animus-' .next/server/**/*.html || grep -rq 'animus-' .next/static/**/*.js

# No Emotion runtime leaked
! grep -rq '@emotion' .next/static/**/*.js

# No unresolved transform placeholders
! grep -rq '__TRANSFORM__' .next/static/css/*.css

# Both routers rendered
test -d .next/server/app
test -f .next/server/pages/legacy.html
```

Exact paths depend on Next.js build output structure — will be refined during implementation.

## Risks / Trade-offs

**[Next.js CSS output paths]** → Next.js's `.next/` output structure varies between versions. Assertion paths may need adjustment. **Mitigation:** Use `find` + `grep` instead of hardcoded paths.

**[Dual-router CSS deduplication]** → If both routers import the same CSS file, Next.js should deduplicate. If it doesn't, the CSS may be emitted twice. **Mitigation:** Acceptable for a test fixture. Monitor bundle size but don't optimize.

**[Dependency on next-webpack-plugin]** → This app can't build until the plugin exists. **Mitigation:** Tasks are ordered: plugin first, then test app. The app proposal is scaffolded now so implementation can begin as soon as the plugin lands.
