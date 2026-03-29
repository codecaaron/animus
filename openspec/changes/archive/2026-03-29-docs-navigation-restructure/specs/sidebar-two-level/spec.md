## ADDED Requirements

### Requirement: Two-level sidebar hierarchy

The sidebar SHALL render navigation items at two distinct visual levels: section (L1) and page (L2).

#### Scenario: Section with children

- **WHEN** the sidebar renders a section that has child pages (e.g., Core Concepts)
- **THEN** the section label renders at L1 and its child pages render at L2 below it

#### Scenario: Section without children

- **WHEN** the sidebar renders a section with no child pages (e.g., Getting Started)
- **THEN** the section renders at L1 only with no L2 items

### Requirement: Active section indicator

The sidebar SHALL visually indicate which section the user is currently in.

#### Scenario: User is on a concept page

- **WHEN** user is at `/docs/concepts/design-tokens`
- **THEN** the "Core Concepts" L1 item displays an active highlight

#### Scenario: User navigates between sections

- **WHEN** user moves from `/docs/concepts/design-tokens` to `/docs/api/create-theme`
- **THEN** the active highlight moves from "Core Concepts" to "API Reference"

### Requirement: Active page indicator

The sidebar SHALL visually indicate which specific page the user is on, distinct from the section indicator.

#### Scenario: Active page within a section

- **WHEN** user is at `/docs/concepts/design-tokens`
- **THEN** the "Design Tokens" L2 item shows an active indicator (color shift, left border, or similar) that is visually distinct from the L1 section highlight

### Requirement: Visual distinction between levels

L1 and L2 items SHALL be visually distinguishable at a glance — not solely by indentation.

#### Scenario: Scanning the sidebar

- **WHEN** a user glances at the sidebar
- **THEN** L1 items are distinguishable from L2 items through at least two visual cues (e.g., font weight, font size, color, letter spacing)

### Requirement: Route-driven navigation

Every sidebar item SHALL correspond to a route change. The sidebar SHALL NOT contain anchor links.

#### Scenario: Click a sidebar item

- **WHEN** user clicks any sidebar item
- **THEN** a route navigation occurs (URL path changes), not a scroll-to-anchor

### Requirement: Sidebar driven by configuration

The sidebar content SHALL be driven by a static route configuration, not by DOM inspection or file system queries.

#### Scenario: Sidebar renders on page load

- **WHEN** the docs layout mounts
- **THEN** the sidebar renders all sections and pages from the route configuration without waiting for content to load
