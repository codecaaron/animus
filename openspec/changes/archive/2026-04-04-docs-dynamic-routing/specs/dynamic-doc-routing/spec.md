## ADDED Requirements

### Requirement: Content resolution from URL path
The system SHALL resolve markdown content for doc pages by deriving the content file path from the URL path using the convention: URL segment after `/docs/` maps to `content/<segment>.md`.

#### Scenario: Standard page resolution
- **WHEN** a user navigates to `/docs/authoring/base-styling`
- **THEN** the system renders the content from `content/authoring/base-styling.md`

#### Scenario: Docs index resolution
- **WHEN** a user navigates to `/docs` (index route)
- **THEN** the system renders the content from `content/introduction.md`

#### Scenario: Missing content file
- **WHEN** a URL path has no matching `.md` file in the content directory
- **THEN** the system renders the NotFound component

### Requirement: Nav-driven route generation
The system SHALL generate all doc `<Route>` elements from the `DOCS_NAV` configuration in `docsNav.ts`. No manual route definitions for markdown doc pages SHALL exist in `App.tsx`.

#### Scenario: Leaf nav entry produces a route
- **WHEN** `DOCS_NAV` contains `{ label: 'TypeScript', path: '/docs/advanced/typescript' }`
- **THEN** a `<Route path="typescript">` is generated that renders `DocPage` with the resolved content

#### Scenario: Section with children produces parent route with index redirect
- **WHEN** `DOCS_NAV` contains a section with `path: '/docs/authoring'` and children
- **THEN** a `<Route path="authoring">` is generated with an index `<Navigate>` to the first child's path

#### Scenario: All 18 existing doc pages remain routable
- **WHEN** the nav config contains all current entries
- **THEN** every URL that worked before the change continues to resolve to the same content

### Requirement: Single DocPage component
The system SHALL use a single `DocPage` component for all markdown doc pages. No per-page wrapper `.tsx` files SHALL exist.

#### Scenario: DocPage renders MarkdownContent
- **WHEN** `DocPage` receives a valid content key
- **THEN** it passes the raw markdown string to `<MarkdownContent source={content} />`

#### Scenario: No per-page wrappers remain
- **WHEN** the change is complete
- **THEN** `pages/overview/`, `pages/compiler/`, `pages/architecture/`, `pages/authoring/`, `pages/advanced/`, `pages/support/` directories contain no files (or are deleted)

### Requirement: Eager content loading
The system SHALL load all markdown content eagerly at build time using `import.meta.glob` with `eager: true`. No lazy loading or Suspense boundaries SHALL be required for doc page content.

#### Scenario: All content available without network requests
- **WHEN** the docs layout mounts
- **THEN** navigating between doc pages does not trigger additional network requests for content

### Requirement: Dead code removal
All files in `pages/_archive/` SHALL be deleted. All per-page wrapper `.tsx` files replaced by dynamic routing SHALL be deleted.

#### Scenario: Archive cleanup
- **WHEN** the change is complete
- **THEN** `pages/_archive/` does not exist

#### Scenario: Wrapper cleanup
- **WHEN** the change is complete
- **THEN** no `.tsx` file exists whose sole purpose is importing a `.md?raw` file and rendering `MarkdownContent`

### Requirement: Content directory flattening
`content/overview/introduction.md` SHALL be moved to `content/introduction.md`. The `content/overview/` directory SHALL be removed.

#### Scenario: Introduction file relocated
- **WHEN** the change is complete
- **THEN** `content/introduction.md` exists and `content/overview/` does not
