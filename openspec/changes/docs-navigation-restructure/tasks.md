## 1. Page Splitting

- [ ] 1.1 Create `pages/concepts/` directory and split Concepts.tsx into 6 files: BuilderChain.tsx, CascadeContract.tsx, DesignTokens.tsx, ResponsiveProps.tsx, VariantsStates.tsx, SlotComposition.tsx
- [ ] 1.2 Create `pages/api/` directory and split ApiReference.tsx into 6 files: CreateTheme.tsx, CreateSystem.tsx, BuilderChainApi.tsx, CreateTransform.tsx, PropGroups.tsx, VitePlugin.tsx
- [ ] 1.3 Add `scroll-margin-top: 64px` to the Heading component base styles
- [ ] 1.4 Remove original monolithic Concepts.tsx and ApiReference.tsx

## 2. Routing

- [ ] 2.1 Define the DOCS_NAV route configuration object with sections, paths, and children
- [ ] 2.2 Add nested routes in App.tsx for `/docs/concepts/:topic` and `/docs/api/:topic`
- [ ] 2.3 Add index redirects for `/docs/concepts` → `/docs/concepts/builder-chain` and `/docs/api` → `/docs/api/create-theme`
- [ ] 2.4 Add lazy imports for all new topic page components
- [ ] 2.5 Create section layout wrapper components that render `<Outlet>` for nested routes

## 3. Two-Level Sidebar

- [ ] 3.1 Create route configuration data structure (DOCS_NAV) as a shared module
- [ ] 3.2 Create L1 section item component with active highlight styling (font weight, color, or background distinct from L2)
- [ ] 3.3 Create L2 page item component with active indicator (left border + color shift)
- [ ] 3.4 Rewrite Sidebar component to render L1/L2 from DOCS_NAV, using React Router for active state detection
- [ ] 3.5 Ensure sections without children (Why Animus, Getting Started, Examples) render as L1-only clickable items

## 4. Right-Column Page ToC

- [ ] 4.1 Create PageToc component: scans h2[id] and h3[id] on mount and route change, renders anchor links with depth variant
- [ ] 4.2 Implement IntersectionObserver scroll spy with rootMargin tuned for tall code blocks
- [ ] 4.3 Add smooth-scroll click handler with URL hash update
- [ ] 4.4 Add auto-hide behavior when fewer than 2 headings are found
- [ ] 4.5 Style with monospace font, subtle active indicator (color shift + thin left rule), no background panel

## 5. Three-Column Layout

- [ ] 5.1 Rewrite DocsLayout to use CSS grid with three columns: 200px sidebar, 1fr content, 180px ToC
- [ ] 5.2 Integrate PageToc into the right column slot
- [ ] 5.3 Handle ToC auto-hide: when PageToc returns null, content column expands (grid fallback to two columns)

## 6. Responsive Behavior

- [ ] 6.1 Add media query to hide right ToC column at md breakpoint (~1024px)
- [ ] 6.2 Add media query to hide left sidebar at a lower breakpoint (~768px)
- [ ] 6.3 Verify content column maintains 700px+ width at 1280px viewport with all columns visible
- [ ] 6.4 Test layout at 1440px, 1280px, 1024px, and 768px viewports

## 7. Cleanup and Verification

- [ ] 7.1 Remove the existing TableOfContents component from Sidebar
- [ ] 7.2 Update component barrel exports (index.ts) — add PageToc, remove TableOfContents if replaced
- [ ] 7.3 Run `bun run build` to verify extraction succeeds for all new components
- [ ] 7.4 Verify all routes resolve correctly and no existing URLs break (redirects work)
- [ ] 7.5 Verify scroll spy tracks correctly on Concepts and API pages
