## MODIFIED Requirements

### Requirement: CSS-only HMR in dev mode
The Vite plugin SHALL use CSS module invalidation instead of full page reload when style-related files change during development. React component state SHALL be preserved across style updates.

#### Scenario: Style change triggers CSS-only update
- **WHEN** a developer saves a file containing Animus builder chains
- **THEN** the plugin re-analyzes the project and updates the virtual CSS module
- **THEN** Vite sends a CSS-only HMR update (not full-reload)
- **THEN** the page updates styles without losing React state

#### Scenario: Non-extractable change falls through to full reload
- **WHEN** a file change produces no extractable components (e.g., utility function change)
- **THEN** the plugin falls through to Vite's default HMR behavior
- **THEN** React's normal module replacement handles the update

### Requirement: Content-hash file caching
The Vite plugin SHALL cache file contents by content hash during dev mode. On HMR, only files whose content changed SHALL be re-read from disk.

#### Scenario: Unchanged files are skipped
- **WHEN** a single file is saved during dev mode
- **THEN** only that file is re-read from disk
- **THEN** all other file entries reuse their cached content
- **THEN** the full file entry array is passed to `analyzeProject` with minimal I/O

#### Scenario: Single-file HMR latency
- **WHEN** a single file changes in a 100-file project
- **THEN** the HMR cycle completes in under 50ms
