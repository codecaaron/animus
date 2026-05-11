## ADDED Requirements

### Requirement: Extraction runs in development mode
The Vite plugin SHALL perform extraction in development mode (`vite dev`), not only in production builds. The dev server SHALL analyze all source files at startup and maintain a manifest that updates on file changes.

#### Scenario: Dev server startup
- **WHEN** `vite dev` starts
- **THEN** the plugin SHALL run `analyzeProject` on all discovered source files and store the manifest in memory before the first page request is served

#### Scenario: Components render with extracted styles in dev
- **WHEN** a component defined with `animus.styles({...}).asElement('div')` is rendered during dev mode
- **THEN** the rendered element SHALL have extracted CSS class names and the extracted CSS SHALL be served via the virtual CSS module — same as production

#### Scenario: Dev and prod output identical
- **WHEN** the same source files are processed by dev mode and production build
- **THEN** the generated CSS and source transformations SHALL be identical (both use `analyzeProject`)

### Requirement: HMR updates styles on file change
When a source file changes during dev mode, the plugin SHALL re-analyze the project, update the manifest, and trigger a style update so the browser reflects the new styles without a manual refresh.

#### Scenario: Style change triggers CSS update
- **WHEN** a developer changes `animus.styles({ display: 'flex' })` to `animus.styles({ display: 'grid' })` and saves
- **THEN** the browser SHALL update to show the new `display: grid` style without the developer manually refreshing

#### Scenario: New component added
- **WHEN** a developer adds a new component with `animus.styles({...}).asElement('div')` to a file and saves
- **THEN** the new component SHALL be included in the manifest and its CSS SHALL be available

#### Scenario: Variant added
- **WHEN** a developer adds a new variant option to an existing component and saves
- **THEN** the new variant's CSS SHALL appear in the updated styles

### Requirement: Manifest persists across HMR cycles
The manifest SHALL be stored in the plugin's closure scope, persisting across the dev server's lifetime. The `handleHotUpdate` hook SHALL be the only mutation point for the manifest.

#### Scenario: Multiple file changes
- **WHEN** a developer saves file A, then saves file B, then saves file A again
- **THEN** after each save, the manifest SHALL reflect the latest state of ALL files (not just the most recently changed one)

#### Scenario: Server restart resets manifest
- **WHEN** the dev server is restarted
- **THEN** the manifest SHALL be rebuilt from scratch via `analyzeProject`
