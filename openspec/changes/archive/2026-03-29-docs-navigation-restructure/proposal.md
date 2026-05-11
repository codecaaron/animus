## Why

The showcase docs currently use a flat sidebar listing all pages at one level, with in-page anchor links mixed into the same column. As documentation grows — Core Concepts has 17 headings, API Reference has 13 — this single-column approach breaks down. Anchor links crowd the sidebar, there's no visual hierarchy between "which section am I in" and "which page am I on," and long pages lack a dedicated table of contents for quick within-page navigation.

The navigation needs to separate three concerns that are currently conflated: section identity (Concepts vs API Reference), page selection (The Builder Chain vs Design Tokens), and within-page orientation (which heading am I near).

## What Changes

- **Restructure the sidebar into two visual levels.** Level 1 is the doc section (Core Concepts, API Reference, etc.). Level 2 is the page within that section. Every sidebar item represents a route change — no anchor links in the sidebar.
- **Split monolithic doc pages into individual routes.** Core Concepts (currently one page with 6 major sections) becomes 6 routed pages. API Reference (currently one page with 6+ sections) becomes 6 routed pages. Shorter pages (Why Animus, Getting Started) remain single pages with no L2 children.
- **Add a right-column "On this page" ToC.** A separate column listing heading anchors for the current page with scroll spy (IntersectionObserver). Hides when a page has fewer than 2 anchors.
- **Add responsive collapse behavior.** Right-column ToC collapses first (~1024px). Left sidebar persists longer before collapsing. Content column maintains at least 700px at 1280px viewport.
- **Update the docs layout to three columns.** Left sidebar + content + right ToC, replacing the current two-column layout.

## Capabilities

### New Capabilities
- `docs-section-routing`: Nested route structure under each doc section. Core Concepts and API Reference gain sub-routes for each topic page. Section index pages redirect to or render the first child.
- `sidebar-two-level`: Two-level sidebar component with section (L1) and page (L2) items. Active section highlight, active page indicator, visual distinction between levels. Driven by route configuration, not hardcoded links.
- `page-toc`: Right-column table of contents component. Scans page headings, renders anchor links, tracks active heading via IntersectionObserver. Auto-hides on pages with fewer than 2 anchors.
- `docs-responsive-layout`: Three-column docs layout with responsive collapse. Right ToC collapses at ~1024px, left sidebar at a lower breakpoint. Content column width preserved.

### Modified Capabilities
- `developer-knowledge-docs`: Page structure changes from monolithic pages to individual topic pages. Content unchanged, but file organization and routing are restructured.

## Impact

- **Routing:** `App.tsx` gains nested routes under `/docs/concepts/*` and `/docs/api/*`. New layout route wrappers for sections with children.
- **Page files:** `Concepts.tsx` splits into 6 files (builder-chain, cascade-contract, design-tokens, responsive-props, variants-states, slot-composition). `ApiReference.tsx` splits into 6 files (create-theme, create-system, builder-chain-api, create-transform, prop-groups, vite-plugin). Original files removed.
- **Layout:** `DocsLayout.tsx` gains a third column slot for the right ToC. New `DocsThreeColumnLayout` or modification of existing layout.
- **Components:** New `PageToc` component (right column). Existing `Sidebar` rewritten with two-level structure. Existing `TableOfContents` component (currently in sidebar) replaced or removed.
- **Heading component:** May need `scroll-margin-top` added to clear the sticky nav on anchor scroll.
- **Styling:** All new components built with `ds.styles()` chain, extracted via the Animus pipeline. Terminal-forward aesthetic — monospace links, subtle active indicators, no heavy borders or background panels.
