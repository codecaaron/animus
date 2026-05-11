## ADDED Requirements

### Requirement: All publishable packages have homepage field
Every publishable package (`system`, `extract`, `vite-plugin`, `next-plugin`, `properties`) SHALL have a `homepage` field in package.json deep-linked to the package's directory in the GitHub repository.

#### Scenario: Homepage links to package directory
- **WHEN** a consumer views any publishable package on npm
- **THEN** the homepage link SHALL point to `https://github.com/codecaaron/animus/tree/main/packages/<name>#readme`

### Requirement: All publishable packages have repository.directory
Every publishable package SHALL have `repository.directory` set to `packages/<name>` so npm can link to the correct subdirectory in the monorepo.

#### Scenario: Repository directory is set
- **WHEN** a consumer clicks "Repository" on an npm package page
- **THEN** it SHALL navigate to the package's subdirectory, not the monorepo root

### Requirement: All publishable packages have keywords
Every publishable package SHALL have a `keywords` array reflecting npm search intent.

#### Scenario: Consumer-facing packages use discovery keywords
- **WHEN** `system`, `vite-plugin`, or `next-plugin` is published
- **THEN** keywords SHALL include terms that npm users search for (e.g., `css-in-js`, `react`, `design-system`, `zero-runtime`, `static-css`, `typescript`, `vite-plugin`, `nextjs`)
- **AND** keywords SHALL NOT include internal architecture terms that consumers don't search for (e.g., `css-layers`, `static-analysis`, `type-state`)

#### Scenario: Internal packages use technical keywords
- **WHEN** `extract` is published
- **THEN** keywords MAY include technical terms like `rust`, `napi` since developers finding this package are looking for the native addon specifically

### Requirement: Package descriptions are accurate
Every publishable package SHALL have a `description` field that accurately describes its current functionality without referencing deprecated features or packages.

#### Scenario: No stale descriptions
- **WHEN** any publishable package's description is read
- **THEN** it SHALL NOT reference Emotion, styled-components, `@animus-ui/core`, or `@animus-ui/theming`
