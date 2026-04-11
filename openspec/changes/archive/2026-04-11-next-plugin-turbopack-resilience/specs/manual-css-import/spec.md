## ADDED Requirements

### Requirement: CSS import via resolve alias
The plugin SHALL expose `@animus-ui/styles` as an importable path, resolved to `.animus/styles.css` via bundler-native alias mechanisms.

#### Scenario: Webpack resolve alias
- **WHEN** Next.js uses Webpack
- **THEN** `resolve.alias['@animus-ui/styles']` SHALL point to the absolute path of `.animus/styles.css`

#### Scenario: Turbopack resolve alias
- **WHEN** Next.js uses Turbopack
- **THEN** `turbopack.resolveAlias['@animus-ui/styles']` SHALL point to the absolute path of `.animus/styles.css`

#### Scenario: User imports CSS in root layout
- **WHEN** a user adds `import '@animus-ui/styles'` to their root layout file
- **THEN** the bundler SHALL resolve it to `.animus/styles.css` and include the styles in the application bundle

### Requirement: Missing import detection
The plugin SHALL warn when no file in the project imports `@animus-ui/styles`.

#### Scenario: CSS import missing
- **WHEN** extraction completes and the loader processes files without encountering an `@animus-ui/styles` import
- **THEN** the plugin SHALL emit a warning with the exact import line to add and the recommended file location

## REMOVED Requirements

### Requirement: Auto-injection via ROOT_ENTRY_RE
**Reason**: The regex-based root entry detection (`ROOT_ENTRY_RE`) is brittle for route groups, internationalized routing, and parallel routes. Replaced by explicit user-land import.
**Migration**: Add `import '@animus-ui/styles'` to your root layout file (e.g., `app/layout.tsx`).
