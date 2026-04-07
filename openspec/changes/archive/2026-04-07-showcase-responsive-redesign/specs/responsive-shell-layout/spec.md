## ADDED Requirements

### Requirement: NavBar renders as composed family with shared mode variant
The NavBar SHALL be implemented as a `compose()` family with slots: Root, Container, Brand, Links, Actions, MobileTrigger. A shared `mode` variant SHALL control visibility and layout across slots.

#### Scenario: Root provides full-bleed chrome
- **WHEN** NavBar renders
- **THEN** NavBar.Root SHALL provide sticky positioning, background, and border extending to viewport edges. NavBar.Container SHALL constrain inner content to `maxWidth: 1440px` with centered alignment, matching the docs grid max-width.

#### Scenario: Links always visible
- **WHEN** NavBar renders with `mode="inline"`
- **THEN** Links slot SHALL be visible at all viewport widths. The "docs" link is the sole nav item (logo serves as home link).

### Requirement: Drawer component provides slide-out panel with overlay
The Drawer SHALL be implemented as a `compose()` family with slots: Root, Overlay, Panel, Header, Body. A shared `position` variant (left/right) SHALL control the slide direction of Panel. An `open` state SHALL control visibility.

#### Scenario: Drawer opens from left
- **WHEN** Drawer Root has `position="left"` and `open={true}`
- **THEN** the Panel SHALL slide in from the left edge of the viewport and Overlay SHALL cover the remaining viewport area

#### Scenario: Drawer closes on overlay click
- **WHEN** user clicks the Overlay while Drawer is open
- **THEN** the Drawer SHALL close (open state becomes false)

#### Scenario: Drawer closes on Escape key
- **WHEN** user presses Escape while Drawer is open
- **THEN** the Drawer SHALL close and focus SHALL return to the trigger element

### Requirement: DocsBreadcrumb provides mobile navigation context
A DocsBreadcrumb component SHALL render on mobile viewports (`display: flex` below `sm`, hidden at `sm+`), sticky below the NavBar. It SHALL be a pure structure component with no hooks (RSC-safe).

#### Scenario: Breadcrumb shows section and page
- **WHEN** user is on a docs page with a parent section (e.g., `/docs/authoring/base-styling`)
- **THEN** the breadcrumb SHALL display "Component Authoring › Base Styling" resolved from DOCS_NAV

#### Scenario: Breadcrumb opens sidebar drawer
- **WHEN** user taps the breadcrumb bar
- **THEN** the sidebar Drawer SHALL open, providing full docs navigation

#### Scenario: Breadcrumb shows section only for top-level pages
- **WHEN** user is on a top-level docs page (e.g., `/docs`)
- **THEN** the breadcrumb SHALL display only the section label (e.g., "Introduction")

### Requirement: DocsLayout responds to viewport width
The DocsLayout SHALL use a single-tree approach with responsive display values inside variant CSS to adapt the grid layout.

#### Scenario: Mobile viewport shows content only
- **WHEN** viewport width is below the `sm` breakpoint (768px)
- **THEN** sidebar and TOC columns SHALL have `display: none`. DocsBreadcrumb provides navigation context.

#### Scenario: Tablet viewport shows sidebar and content
- **WHEN** viewport width is between `sm` (768px) and `md` (1024px)
- **THEN** sidebar SHALL be visible, TOC SHALL remain hidden

#### Scenario: Desktop viewport shows all three columns
- **WHEN** viewport width is at or above the `md` breakpoint (1024px)
- **THEN** sidebar, content, and TOC columns SHALL all be visible

#### Scenario: Rails flush to navbar
- **WHEN** DocsLayout renders at any viewport width
- **THEN** sidebar and TOC columns SHALL start flush with the navbar (no top padding). Only the content column SHALL have `pt: 48` for visual offset.

#### Scenario: Scrollbar fade on rails
- **WHEN** sidebar or TOC column is not being hovered
- **THEN** the webkit scrollbar thumb SHALL be transparent. On hover, it SHALL fade in via `background-color` transition.

### Requirement: PageNav provides prev/next page links
A PageNav component SHALL render at the bottom of docs content with links to the previous and next pages in the documentation order.

#### Scenario: Both links present
- **WHEN** the current page has both a previous and next page in DOCS_NAV order
- **THEN** two card-style links SHALL render in a 2-column grid: prev (left-aligned) and next (right-aligned)

#### Scenario: First page has no prev
- **WHEN** the current page is the first page in DOCS_NAV
- **THEN** only the next link SHALL render (prev slot empty)

#### Scenario: Card hover state
- **WHEN** user hovers a PageNav card
- **THEN** the card border SHALL change to `primary` color with a `glow-accent` box-shadow

### Requirement: SkipLink provides keyboard shortcut to main content
A SkipLink component SHALL render as the first focusable element in the page. It SHALL be visually hidden until focused.

#### Scenario: SkipLink appears on focus
- **WHEN** user presses Tab from the browser chrome
- **THEN** the SkipLink SHALL become visually visible with text "Skip to content →"

### Requirement: Content width is consistent across pages
All page content containers SHALL use `maxWidth: 48rem`. NavBar inner container and DocsLayout grid SHALL share `maxWidth: 1440px` for flush alignment.

### Requirement: Animations respect reduced-motion preference
All animated components SHALL include `@media (prefers-reduced-motion: reduce)` styles that disable or reduce motion.

### Requirement: Drawer implements keyboard focus management
The Drawer Panel SHALL trap focus when open. Tab cycling SHALL wrap within the panel. Escape SHALL close the drawer.
