## REMOVED Requirements

### Requirement: Production-only extraction
**Reason**: Replaced by "Dev and prod extraction parity". Extraction now runs in both modes.
**Migration**: The `if (!isProd) return` guard in `buildStart` is removed. The `if (!isProd || !storedManifest)` guard in `transform` is replaced with `if (!storedManifest)`.

## MODIFIED Requirements

### Requirement: Two-phase build architecture
The Vite plugin SHALL implement a two-phase build architecture: Phase 1 runs at `buildStart` to produce a UniverseManifest via full-codebase analysis, Phase 2 uses the manifest during per-file `transform` hooks. This architecture SHALL operate in BOTH dev and prod modes.

#### Scenario: buildStart produces manifest
- **WHEN** Vite calls `buildStart` in either dev or prod mode
- **THEN** the plugin SHALL: (1) evaluate the theme via bun subprocess, (2) serialize config and group registry, (3) discover all source files matching include/exclude patterns, (4) read all file sources, (5) call `analyze_project()` to produce the manifest, (6) store the manifest and its CSS in memory, (7) pre-resolve transform placeholders, (8) populate the file cache with content hashes (dev mode only)

#### Scenario: transform uses manifest in both modes
- **WHEN** a file is processed by the `transform` hook in either dev or prod mode
- **THEN** the plugin SHALL call `transform_file(code, id, manifestJson)` to produce transformed source, replacing builder chains with `createComponent` shim calls

#### Scenario: Dev mode runs full extraction
- **WHEN** Vite runs in development mode (`vite dev`)
- **THEN** the plugin SHALL run the full extraction pipeline at server start, producing a manifest and populating the virtual CSS module with both theme variables AND component styles

### Requirement: CSS-only HMR in dev mode
The Vite plugin SHALL re-run `analyzeProject` when extractable files change during development, invalidate the virtual CSS module, and return BOTH the default affected modules AND the CSS module in the HMR array. This ensures the browser re-fetches updated CSS alongside the re-transformed component JS.

#### Scenario: Style change triggers coordinated update
- **WHEN** a developer saves a file containing Animus builder chains during `vite dev`
- **THEN** the plugin SHALL re-read the changed file, update its cache entry, rebuild the file entries array, call `analyzeProject`, update the stored manifest, apply transform post-processing, and invalidate the virtual CSS module
- **THEN** the plugin SHALL return `[...modules, cssModule]` — the default affected modules PLUS the CSS virtual module
- **THEN** Vite SHALL HMR both the component JS (re-transformed with updated manifest) and the CSS (updated rules)
- **THEN** React Fast Refresh SHALL preserve component state when the component tree structure is unchanged

#### Scenario: Content hash unchanged — no work
- **WHEN** a file is saved but its content hash matches the cached hash
- **THEN** the plugin SHALL return an empty array from `handleHotUpdate`, suppressing unnecessary HMR

#### Scenario: Non-extractable file change falls through
- **WHEN** a changed file has no extension matching `.ts`, `.tsx`, `.js`, `.jsx` or matches an exclude pattern
- **THEN** the plugin SHALL not intercept the HMR event, falling through to Vite's default behavior

#### Scenario: Config file change triggers geological reset
- **WHEN** the changed file matches the resolved `configPath` option
- **THEN** the plugin SHALL re-evaluate config via bun subprocess, re-run full extraction, invalidate the CSS module, and return `[...modules, cssModule]`

#### Scenario: Theme file change triggers geological reset
- **WHEN** the changed file matches the resolved theme path (explicit `themePath` or auto-detected)
- **THEN** the plugin SHALL re-evaluate the theme via bun subprocess, re-run full extraction, invalidate the CSS module, and return `[...modules, cssModule]`

### Requirement: Content-hash file caching
The Vite plugin SHALL maintain a `Map<string, { hash: string; source: string }>` file cache in the plugin closure during dev mode. The cache SHALL be populated at `buildStart` with all discovered files and updated incrementally on each `handleHotUpdate` event.

#### Scenario: Cache populated at build start
- **WHEN** `buildStart` completes file discovery and reading in dev mode
- **THEN** the file cache SHALL contain an entry for every discovered file with its MD5 content hash and source string

#### Scenario: Single file updated on HMR
- **WHEN** `handleHotUpdate` fires for a file with a changed content hash
- **THEN** only that file's cache entry SHALL be updated (new hash + new source)
- **THEN** all other cache entries SHALL remain unchanged

#### Scenario: File entries rebuilt from cache
- **WHEN** the plugin needs to re-run `analyzeProject` after an HMR event
- **THEN** it SHALL build the file entries array by iterating the cache map, using cached source strings for all files (including the freshly updated one)

## ADDED Requirements

### Requirement: handleHotUpdate lifecycle
The Vite plugin SHALL implement a `handleHotUpdate` hook that receives the `{ file, server, modules }` context and follows the lifecycle: (1) check file relevance, (2) compute content hash, (3) classify change tier, (4) execute tier-appropriate action, (5) invalidate CSS module, (6) return `[...modules, cssModule]`.

#### Scenario: Irrelevant file ignored
- **WHEN** `handleHotUpdate` fires for a file with extension not in `.ts`, `.tsx`, `.js`, `.jsx`
- **THEN** the plugin SHALL return `undefined` (no interception)

#### Scenario: Excluded file ignored
- **WHEN** `handleHotUpdate` fires for a file matching an exclude pattern (e.g., `node_modules`, `dist`)
- **THEN** the plugin SHALL return `undefined`

#### Scenario: Unchanged file skipped
- **WHEN** the file's MD5 content hash matches the cached hash
- **THEN** the plugin SHALL return an empty array (suppress default HMR for this file)

#### Scenario: Changed file triggers re-extraction and coordinated HMR
- **WHEN** the file's content hash differs from the cached hash
- **THEN** the plugin SHALL: (1) update the cache entry, (2) rebuild file entries from cache, (3) re-run `analyzeProject`, (4) apply transform post-processing, (5) update stored manifest, (6) invalidate the virtual CSS module, (7) return `[...modules, cssModule]`

### Requirement: Transform post-processing in handleHotUpdate
The `handleHotUpdate` hook SHALL apply the same transform post-processing (resolve `__TRANSFORM__` placeholders via bun subprocess) that the `load` hook applies. The resolved CSS SHALL be stored so the `load` hook can serve it directly.

#### Scenario: Transforms resolved during HMR
- **WHEN** `analyzeProject` produces CSS containing `__TRANSFORM__fluid__16-24__` placeholders
- **THEN** the `handleHotUpdate` handler SHALL resolve these placeholders using the same bun subprocess mechanism as the `load` hook
- **THEN** the stored manifest CSS SHALL contain the fully resolved CSS values

#### Scenario: Load hook serves pre-resolved CSS
- **WHEN** the `load` hook is invoked for the virtual CSS module after an HMR update
- **THEN** it SHALL serve the pre-resolved CSS (theme variables + component CSS) without re-running transform resolution

### Requirement: Stable class name hashing
The Rust `make_class_name` function SHALL hash from `filename::binding` (file path + variable name) rather than the chain source text. This ensures class names are stable across style value edits, which is required for HMR — both the CSS rules and the JS `createComponent` calls must reference the same class name after an update.

#### Scenario: Style edit produces same class name
- **WHEN** a component's style value changes (e.g., `fontWeight: 700` → `fontWeight: 400`)
- **THEN** the generated class name SHALL remain identical (same filename, same binding)
- **THEN** the CSS rule selector matches the element's class attribute without re-rendering

#### Scenario: Different files produce different hashes
- **WHEN** two components with the same binding name exist in different files
- **THEN** they SHALL produce different class names (different filename in hash input)

#### Scenario: Same file, same binding always stable
- **WHEN** the same component is re-extracted after any style edit
- **THEN** the class name SHALL be deterministic and identical to the previous extraction
