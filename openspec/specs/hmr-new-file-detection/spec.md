## Purpose

Requirements for the `hmr-new-file-detection` capability: Transform-time new file detection; CSS invalidation after new file analysis; New file detection logging; Watcher deletion pruning.

## Requirements

### Requirement: Transform-time new file detection

In dev mode, when the `transform` hook encounters a file that is NOT in `fileCache`, the plugin SHALL treat it as a new file: compute its content hash, register it in `fileCache`, rebuild the file entries list, and re-run `analyzeProject()` synchronously. If the re-analysis produces manifest entries for the file, the plugin SHALL transform it normally. If no entries are produced, the plugin SHALL return `null`.

#### Scenario: New component file detected and extracted

- **WHEN** a new `.tsx` file containing `ds.styles(...).asElement('div')` is created during dev
- **AND** another file imports and uses it
- **AND** the `transform` hook is called for the new file
- **THEN** the plugin SHALL add the file to `fileCache` with its content hash
- **AND** call `runAnalysis()` with the updated file entries
- **AND** return the transformed source with `createComponent()` replacement

#### Scenario: New non-component file passes through

- **WHEN** a new `.tsx` file with no builder chains is created during dev
- **AND** the `transform` hook is called for it
- **THEN** the plugin SHALL add the file to `fileCache`
- **AND** call `runAnalysis()` with the updated file entries
- **AND** return `null` (no transformation needed — file has no extractable components)

#### Scenario: Known file without components skips re-analysis

- **WHEN** a file is already in `fileCache` but has no entries in the manifest
- **AND** the `transform` hook is called for it
- **THEN** the plugin SHALL NOT re-run analysis (the file is known, just not extractable)
- **AND** return `null`

#### Scenario: Detection fires only once per file

- **WHEN** a new file is detected and registered in `fileCache` during transform
- **AND** the file is subsequently modified, triggering HMR
- **THEN** `handleHotUpdate` SHALL process the file normally via the existing content-hash path
- **AND** the transform hook SHALL NOT trigger new-file detection again (file is now in `fileCache`)

### Requirement: CSS invalidation after new file analysis

After detecting a new file and running re-analysis in the transform hook, the plugin SHALL invalidate the component CSS virtual module (`virtual:animus/components.js`) and the system props virtual module, then trigger a client reload. This ensures the adopted stylesheet and the system prop map both include the newly extracted component. Creation and deletion share this invalidation path.

#### Scenario: Adopted stylesheet updated after new file extraction

- **WHEN** a new component file is detected and extracted during transform
- **THEN** the plugin SHALL invalidate the `virtual:animus/components.js` and system props modules in the module graph
- **AND** trigger a client reload so the browser's adopted stylesheet picks up the new component CSS

#### Scenario: No CSS invalidation for non-component files

- **WHEN** a new file is detected during transform but produces no manifest entries
- **THEN** the plugin SHALL NOT invalidate any virtual modules

### Requirement: New file detection logging

New file detection events SHALL be logged at the standard logging level (not verbose-only). The log message SHALL include the file path and whether extraction produced components.

#### Scenario: Component file detected

- **WHEN** a new file is detected and extraction produces components
- **THEN** the plugin SHALL log: `New file detected: <relativePath> — <N> components extracted`

#### Scenario: Non-component file detected

- **WHEN** a new file is detected but extraction produces no components
- **THEN** the plugin SHALL log: `New file detected: <relativePath> — no components`

### Requirement: Watcher deletion pruning

In dev mode, on a watcher `delete` event the Vite plugin SHALL prune the removed file from `fileCache`, trying BOTH key forms — the plain rootDir-relative path and the `.tsx`-suffixed key that MDX sources carry after preprocessing. When an entry was actually removed, the plugin SHALL rebuild the file entries list, re-run `analyzeProject()`, invalidate the component-CSS and system-props virtual modules, and trigger a client reload. This is the symmetric counterpart of transform-time new-file detection: `handleHotUpdate` fires for `update` events only, so without this hook the deleted file's last-known source rides along as a ghost entry on every later re-analysis and its CSS survives for the life of the dev server process.

#### Scenario: Deleted component's CSS leaves the dev stylesheet

- **WHEN** a component file is deleted during dev and the watcher emits a `delete` event for it
- **THEN** the plugin SHALL remove its `fileCache` entry, re-run analysis over the remaining entries, invalidate the component-CSS and system-props virtual modules, and reload the client
- **AND** the deleted component's CSS SHALL be absent from the dev stylesheet without a server restart

#### Scenario: Deleted MDX source pruned under its preprocessed key

- **WHEN** a deleted file was ingested under its MDX `.tsx`-suffixed cache key rather than its plain rootDir-relative path
- **THEN** the prune SHALL still remove it — both key forms are tried

#### Scenario: Delete for an untracked file is a no-op

- **WHEN** a watcher `delete` event names a file that is not in `fileCache`, or the plugin is running in a production build
- **THEN** the plugin SHALL NOT re-run analysis and SHALL NOT invalidate any virtual modules
