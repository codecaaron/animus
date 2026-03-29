## ADDED Requirements

### Requirement: Right-column table of contents

The docs layout SHALL include a right-column region that displays heading anchors for the current page under an "On this page" label.

#### Scenario: Page with multiple headings

- **WHEN** user views a page with 3+ heading anchors (e.g., Variants & States with h2 and h3 headings)
- **THEN** the right column renders a list of heading links corresponding to the page's h2 and h3 elements

### Requirement: Heading hierarchy in ToC

The ToC SHALL visually distinguish h2 headings from h3 headings to reflect the page structure.

#### Scenario: Mixed heading levels

- **WHEN** a page has h2 "Variants & States" with h3 children "Variants", "Compound variants", "States"
- **THEN** the h2 appears at base indentation and h3 items appear indented with reduced visual weight

### Requirement: Scroll spy active tracking

The ToC SHALL highlight the heading anchor nearest to the user's current scroll position.

#### Scenario: Scroll through sections

- **WHEN** user scrolls from "Design Tokens" section into "Token aliasing" section
- **THEN** the active indicator in the ToC moves from "Design Tokens" to "Token aliasing"

#### Scenario: Page with tall code blocks

- **WHEN** a page section contains tall code blocks that push the next heading far below
- **THEN** the current heading remains active until the next heading enters the observation region, without skipping or lagging

### Requirement: Auto-hide on sparse pages

The ToC SHALL hide entirely when the current page has fewer than 2 heading anchors.

#### Scenario: Page with one heading

- **WHEN** user views a page that has only 1 h2 heading and no h3 headings
- **THEN** the right column is hidden and the content area expands to fill the space

#### Scenario: Page with no headings

- **WHEN** user views a page with no heading anchors
- **THEN** the right column is hidden

### Requirement: Anchor click scrolls to heading

Clicking a ToC link SHALL smooth-scroll the page to the corresponding heading and update the URL hash.

#### Scenario: Click a ToC anchor

- **WHEN** user clicks "Token aliasing" in the ToC
- **THEN** the page smooth-scrolls to the "Token aliasing" heading, the URL updates to include `#token-aliasing`, and the heading is visible below the sticky nav bar

### Requirement: Terminal-forward aesthetic

The ToC SHALL use monospace typography, subtle active indicators, and no heavy borders or background panels. It SHALL feel consistent with the code block aesthetic of the docs.

#### Scenario: Visual consistency

- **WHEN** the ToC renders alongside code-heavy content
- **THEN** the ToC uses the same monospace font family as code elements, with quiet color treatment that doesn't compete with the content
