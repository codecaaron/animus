## MODIFIED Requirements

### Requirement: Plugin activation in all modes
The Vite plugin SHALL perform extraction in BOTH development mode (`vite dev`) and production builds (`vite build`). The production-only guard SHALL be removed. Analysis runs at `buildStart` in both modes. Dev mode additionally uses `handleHotUpdate` for incremental updates.

#### Scenario: Dev mode analysis
- **WHEN** `vite dev` starts and `buildStart` fires
- **THEN** the plugin SHALL discover files, run `analyzeProject`, store the manifest, and serve extracted CSS via the virtual module

#### Scenario: Production build analysis
- **WHEN** `vite build` runs and `buildStart` fires
- **THEN** the plugin SHALL behave identically to the current implementation — discover files, analyze, generate CSS, transform sources

#### Scenario: Dev mode transform
- **WHEN** a `.tsx` file is requested during dev mode
- **THEN** the `transform` hook SHALL use the current manifest to replace animus chains with `createComponent` calls, same as production

### Requirement: handleHotUpdate for manifest re-analysis
The plugin SHALL implement the `handleHotUpdate` Vite hook. When a relevant source file changes, the plugin SHALL update the stored file entries, re-run `analyzeProject`, update the manifest and CSS, and trigger a browser update.

#### Scenario: File change triggers re-analysis
- **WHEN** a `.tsx` file changes during dev mode
- **THEN** `handleHotUpdate` SHALL update the file's source in the stored entries, re-run `analyzeProject`, and update `manifestJson`/`manifestCss` in the closure

#### Scenario: CSS virtual module invalidated
- **WHEN** re-analysis produces updated CSS
- **THEN** the plugin SHALL invalidate the CSS virtual module in Vite's module graph and trigger a browser update (full reload initially, CSS-only HMR as future optimization)

#### Scenario: Non-relevant file ignored
- **WHEN** a file that is not `.ts`/`.tsx`/`.js`/`.jsx` changes (e.g., `.md`, `.json`)
- **THEN** `handleHotUpdate` SHALL not re-analyze — the manifest stays unchanged
