## 1. Foundation — Tokens & Primitives

- [x] 1.1 Add `drawerWidth` size token (280px) and `glow-edge` shadow token to ds.ts
- [x] 1.2 Create SkipLink component
- [x] 1.3 Add `id="main-content"` to Main element in Shell.tsx
- [x] 1.4 Add `prefers-reduced-motion: reduce` to RevealBlock
- [x] 1.5 Add `prefers-reduced-motion: reduce` to Logo animation

## 2. Drawer Component

- [x] 2.1–2.9 Drawer fully implemented (compose family, portal, focus trap, ARIA, spring animation)
- [x] 2.10 Removed dead `useDrawerClose` export — was breaking Vite Fast Refresh (session 50)

## 3. NavBar Component

- [x] 3.1–3.7 NavBar fully implemented (compose family, inline/compact modes)
- [x] 3.8 Added NavBar.Container slot — inner max-width (1440px) constrained flex container, aligns with docs content (session 50)
- [x] 3.9 NavBar.Root becomes full-bleed (bg/border extends to viewport edge, content centered) (session 50)

## 4. Shell Integration

- [x] 4.1–4.5 Shell rewritten with NavBar, Drawer, SkipLink
- [x] 4.6 Removed MobileTrigger `{` hamburger — replaced by breadcrumb on docs pages, "docs" link always visible (session 50)
- [x] 4.7 Removed "home" nav link — logo serves as home link (session 50)
- [x] 4.8 Added DocsBreadcrumb — mobile-only sticky bar below nav, shows Section > Page, opens sidebar drawer (session 50)
- [x] 4.9 Breadcrumb resolves section/page from DOCS_NAV via `resolveBreadcrumb()` in Shell (session 50)
- [x] 4.10 Removed PageToc from sidebar Drawer content (session 50)

## 5. Responsive DocsLayout

- [x] 5.1 Single-tree layout with responsive display values inside variant CSS
- [x] 5.2 Sidebar hidden below sm, TOC hidden below md via variant CSS
- [x] 5.3 Removed pt from LayoutRoot — sidebar/TOC rails flush to navbar edge (session 50)
- [x] 5.4 Added pt: 48 to LayoutContent only — content offset maintained (session 50)
- [x] 5.5 Scrollbar fade on LayoutSidebar + LayoutToc — webkit-scrollbar-thumb transparent, visible on hover (session 50)
- [x] 5.6 Added PageNav prev/next component at bottom of content (session 50)

## 6. ColorPalette Component

- [x] 6.1–6.8 ColorPalette implemented (radiogroup, 10 modes, keyboard nav)
- [x] 6.9 Active state redesigned: 2px border in each mode's own primary color on swatch card, removed glow-edge box-shadow (session 50)
- [x] 6.10 Swatch order: darks left column, lights right column (session 50)

## 7. Examples Page Navigation

- [x] 7.1–7.11 ExampleNav fully implemented

## 8. Content Width Normalization

- [x] 8.1–8.3 All content containers normalized to 48rem

## 9. Verification

- [x] 9.1 `bun run verify:showcase` passes
- [x] 9.2 Manual viewport testing (400px → 768px → 1024px → 1440px)
- [x] 9.3 Keyboard navigation test
- [x] 9.4 Reduced motion test

## 10. Follow-ups (next session)

- [ ] 10.1 HMR doesn't pick up new files — buildStart runs once, new component files need dev server restart. Spike for vite-plugin.
- [ ] 10.2 PageToc desktop visual redesign — glow active state, better depth treatment, truncation
