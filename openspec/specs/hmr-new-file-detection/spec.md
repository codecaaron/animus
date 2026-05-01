## ADDED Requirements

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

After detecting a new file and running re-analysis in the transform hook, the plugin SHALL invalidate the component CSS virtual module (`virtual:animus/components.js`) and send an HMR update to the browser. This ensures the adopted stylesheet includes CSS for the newly extracted component.

#### Scenario: Adopted stylesheet updated after new file extraction

- **WHEN** a new component file is detected and extracted during transform
- **THEN** the plugin SHALL invalidate the `virtual:animus/components.js` module in the module graph
- **AND** send an HMR update so the browser's adopted stylesheet picks up the new component CSS

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
