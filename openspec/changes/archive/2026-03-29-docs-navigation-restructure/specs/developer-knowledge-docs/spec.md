## MODIFIED Requirements

### Requirement: Core Concepts page structure

The Core Concepts documentation SHALL be organized as individual topic pages under a section route, rather than a single monolithic page.

#### Scenario: Access a specific concept

- **WHEN** user navigates to `/docs/concepts/design-tokens`
- **THEN** the Design Tokens content renders as a standalone page with its own headings and code examples

#### Scenario: Content preservation

- **WHEN** the Core Concepts content is split into individual pages
- **THEN** all existing content (prose, code examples, demos) is preserved without modification

### Requirement: API Reference page structure

The API Reference documentation SHALL be organized as individual topic pages under a section route, rather than a single monolithic page.

#### Scenario: Access a specific API page

- **WHEN** user navigates to `/docs/api/prop-groups`
- **THEN** the Prop Groups content renders as a standalone page with its own headings and tables

#### Scenario: Content preservation

- **WHEN** the API Reference content is split into individual pages
- **THEN** all existing content (signatures, parameter tables, code examples) is preserved without modification

### Requirement: Heading scroll offset

All heading elements with IDs SHALL include scroll margin to clear the sticky navigation bar when used as anchor targets.

#### Scenario: Anchor link to heading

- **WHEN** user clicks a link that targets a heading anchor (from ToC, sidebar, or external link)
- **THEN** the heading scrolls into view below the sticky nav bar with visible breathing room above it
