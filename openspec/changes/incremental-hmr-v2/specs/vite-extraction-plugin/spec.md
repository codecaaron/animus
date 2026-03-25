## MODIFIED Requirements

### Requirement: Plugin passes content hashes to Rust in dev mode

In dev mode, the Vite plugin SHALL include per-file content hashes in the `fileEntries` array passed to `analyzeProject()`. Hashes SHALL be computed from the file source text using the existing `contentHash()` function (MD5).

#### Scenario: Dev HMR includes hashes
- **WHEN** `handleHotUpdate` triggers `runAnalysis()` in dev mode
- **THEN** each file entry includes its content hash from `fileCache`

#### Scenario: Prod build omits hashes
- **WHEN** `buildStart` triggers `runAnalysis()` in prod mode
- **THEN** file entries do NOT include hashes (full analysis, no caching)

---

### Requirement: Plugin passes dev_mode flag to Rust

In dev mode, the Vite plugin SHALL pass `dev_mode: true` to `analyzeProject()`. In prod mode, `dev_mode` SHALL be `false` or omitted.

#### Scenario: Dev server analysis
- **WHEN** the Vite dev server calls `runAnalysis()`
- **THEN** `analyzeProject()` is called with `dev_mode: true`

#### Scenario: Production build analysis
- **WHEN** a production Vite build calls `runAnalysis()`
- **THEN** `analyzeProject()` is called with `dev_mode: false` or the parameter is omitted

---

### Requirement: Geological reset clears Rust cache

When a geological reset occurs (theme, config, or system file change), the plugin SHALL signal the Rust crate to clear its per-file cache before running analysis. This MAY be achieved by passing empty hashes (forcing full re-parse) or by calling a dedicated cache-clear function.

#### Scenario: System file change clears cache
- **WHEN** the system module file changes triggering a geological reset
- **THEN** the next `analyzeProject()` call re-parses all files from source (cache fully invalidated)
