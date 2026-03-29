## ADDED Requirements

### Requirement: Nested routes for multi-topic sections

The routing system SHALL support nested routes under doc sections that contain multiple topic pages. Each topic page SHALL be an individually addressable route.

#### Scenario: Navigate to a concept topic

- **WHEN** user visits `/docs/concepts/design-tokens`
- **THEN** the Design Tokens page renders in the content area with the Core Concepts section active in the sidebar

#### Scenario: Navigate to an API topic

- **WHEN** user visits `/docs/api/create-theme`
- **THEN** the createTheme() page renders in the content area with the API Reference section active in the sidebar

### Requirement: Section index redirect

Section paths without a topic slug SHALL redirect to the first child page in that section.

#### Scenario: Visit section root

- **WHEN** user visits `/docs/concepts`
- **THEN** the browser redirects to `/docs/concepts/builder-chain`

#### Scenario: Visit API section root

- **WHEN** user visits `/docs/api`
- **THEN** the browser redirects to `/docs/api/create-theme`

### Requirement: Flat pages remain unchanged

Doc sections with a single page (no children) SHALL render directly at their path without nesting.

#### Scenario: Visit Getting Started

- **WHEN** user visits `/docs/start`
- **THEN** the Getting Started page renders without redirect or nested routing

#### Scenario: Visit Why Animus

- **WHEN** user visits `/docs`
- **THEN** the Why Animus page renders as the docs index

### Requirement: Code splitting per topic page

Each topic page SHALL be a separate lazy-loaded module to maintain bundle splitting.

#### Scenario: Load a concept page

- **WHEN** user navigates to `/docs/concepts/cascade-contract`
- **THEN** only the cascade-contract page module is loaded, not all concept pages
