## 1. Routing & Layout Infrastructure

- [x] 1.1 Update App.tsx router: add DocsLayout nested route with `/docs` parent route and child routes for `start`, `concepts`, `api`
- [x] 1.2 Create DocsLayout component (`src/layout/DocsLayout.tsx`): sidebar + content area with `<Outlet />`
- [x] 1.3 Add scroll-to-top behavior: `useEffect` on `useLocation().pathname` calling `window.scrollTo(0, 0)`
- [x] 1.4 Add 404 catch-all route with simple "not found" message
- [x] 1.5 Add color mode initialization script to `index.html` (blocking `<script>` that reads localStorage and sets `data-color-mode` before first paint)

## 2. New Components — Docs Infrastructure

- [x] 2.1 Create Sidebar component (`src/components/docs/Sidebar.tsx`): vertical nav list with NavLink active state, sticky positioning, route config as data
- [x] 2.2 Create ColorModeToggle component (`src/components/docs/ColorModeToggle.tsx`): toggle button that sets `data-color-mode` on `<html>` and writes to localStorage. Add to Shell nav.
- [x] 2.3 Create Heading component (`src/components/docs/Heading.tsx`): wrapper function over styled primitive, `level` variant (2/3) + `as` prop for element, auto-generated kebab-case `id` from children
- [x] 2.4 Create CodeExample component (`src/components/docs/CodeExample.tsx`): wraps two SyntaxBlock instances with labels, `layout` variant (`stacked`/`split`), neutral container (not CodeFrame)

## 3. New Components — Content Primitives

- [x] 3.1 Create InlineCode component (`src/components/typography/InlineCode.tsx`): promote from Docs.tsx inline `Code` to shared component. Monospace, inline display, background.
- [x] 3.2 Create List component (`src/components/typography/List.tsx`): wrapper function, `kind` variant (`ordered`/`unordered`), maps to `as="ol"` or `as="ul"`
- [x] 3.3 Create Table primitives (`src/components/surfaces/Table.tsx`): TableContainer (overflow scroll `<table>`), Th, Td as builder-chain components
- [x] 3.4 Add all new components to `src/components/index.ts` barrel export with `// Docs` section

## 4. Page: Home (`/`)

- [x] 4.1 Refactor current Home.tsx: keep hero section, add headline + one-line descriptor
- [x] 4.2 Add input/output CodeExample: builder chain TypeScript → generated CSS
- [x] 4.3 Add key differentiators section (zero runtime, type-safe, cascade layers, Rust extraction, design tokens)
- [x] 4.4 Add call-to-action links to Getting Started and Why Animus

## 5. Page: Why Animus (`/docs`)

- [x] 5.1 Create Why page (`src/pages/Why.tsx`): problem statement (runtime CSS-in-JS is dead)
- [x] 5.2 Add failed alternatives section (utility-first lost component abstraction, CSS Modules lost tokens)
- [x] 5.3 Add the Animus approach section (keep DX, move to build time, Rust pipeline)
- [x] 5.4 Add cascade contract explanation (7 layers, builder chain = cascade)
- [x] 5.5 Add "when to use / when not to use" section

## 6. Page: Getting Started (`/docs/start`)

- [x] 6.1 Create GettingStarted page (`src/pages/GettingStarted.tsx`): prerequisites
- [x] 6.2 Step 1: Install (`bun add @animus-ui/system @animus-ui/vite-plugin`)
- [x] 6.3 Step 2: Configure Vite (vite.config.ts with animusExtract)
- [x] 6.4 Step 3: Create design system (minimal createTheme + createSystem + module augmentation)
- [x] 6.5 Step 4: Import virtual stylesheet
- [x] 6.6 Step 5: Build first component (Button with variant) + token resolution note
- [x] 6.7 Step 6: Build and verify (expected CSS output)

## 7. Page: Core Concepts (`/docs/concepts`)

- [x] 7.1 Create Concepts page (`src/pages/Concepts.tsx`): builder chain section with full method breakdown + `.extend()`
- [x] 7.2 Cascade contract section: 7-layer diagram, specificity explanation, concrete example
- [x] 7.3 Design tokens section: createTheme, scales, color modes, token aliasing, generated CSS
- [x] 7.4 Responsive props section: breakpoint-object syntax, generated media queries
- [x] 7.5 Variants & states section: variants (with `base`), `.compound()`, states, input/output for each

## 8. Page: API Reference (`/docs/api`)

- [x] 8.1 Create ApiReference page (`src/pages/ApiReference.tsx`): createTheme() section with signature, chain methods, module augmentation
- [x] 8.2 createSystem() section: signature, withProperties, withGlobalStyles, addGroup composition
- [x] 8.3 Builder chain section: all methods (`.styles()`, `.variant()`, `.compound()`, `.states()`, `.groups()`, `.props()`, `.asElement()`, `.asComponent()`, `.extend()`)
- [x] 8.4 createTransform() section with signature and example
- [x] 8.5 Prop groups section: raw exports as building blocks + addGroup composition example
- [x] 8.6 Vite plugin section: animusExtract options table

## 9. Verification

- [ ] 9.1 `bun run verify` passes (build, test, types, biome)
- [ ] 9.2 `bun run verify:showcase` passes (full pipeline + showcase build)
- [ ] 9.3 Build output shows correct code splitting: separate chunks per page, shared component chunk, single CSS file
- [ ] 9.4 Color mode toggle works: all semantic tokens switch between dark/light
- [ ] 9.5 All routes accessible via direct URL and client-side navigation
- [ ] 9.6 Scroll-to-top works on route change
