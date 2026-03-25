## Purpose

Vite plugin that bridges the Rust extraction crate with the build pipeline. Loads the design system via subprocess, runs project analysis, serves extracted CSS via virtual module, and transforms source files.

## Requirements

### Requirement: Plugin factory function
The plugin factory SHALL accept a `system` option pointing to the module that exports the SystemInstance. This replaces `configPath` and `themePath` as separate options.

#### Scenario: System instance path
- **WHEN** consumer configures `animusExtract({ system: './src/ds.ts' })`
- **THEN** the plugin SHALL load that module via a single bun subprocess to obtain tokens, prop config, group registry, and transforms

#### Scenario: Default configuration
- **WHEN** consumer configures `animusExtract()` with no options
- **THEN** the plugin SHALL auto-detect the system module by searching for a file exporting a SystemInstance (same heuristic as current config/theme auto-detection)

### Requirement: Theme evaluation at build start
Theme evaluation SHALL be replaced by system loading. The plugin SHALL load the system module once at `buildStart`, call `.serialize()`, and hold the result in memory for the duration of the build.

#### Scenario: System loaded at build start
- **WHEN** the Vite build starts
- **THEN** the plugin SHALL run one bun subprocess that imports the system module and returns `ds.serialize()` — containing tokens, propConfig, groupRegistry, and transforms

#### Scenario: Transforms held in memory
- **WHEN** the system is loaded at build start
- **THEN** the transform registry SHALL be built from `serialize().transforms` and held in closure — no separate subprocess for transform resolution

### Requirement: Transform post-processing
Transform post-processing SHALL use the in-memory transform registry from the system's serialized config instead of running a separate bun subprocess.

#### Scenario: Post-process from in-memory registry
- **WHEN** extracted CSS contains `__TRANSFORM__[size](0.5)`
- **THEN** the plugin SHALL resolve it using the transform function from `serialize().transforms['size']` — no subprocess

#### Scenario: Post-process custom transform
- **WHEN** extracted CSS contains `__TRANSFORM__[elevation](3)`
- **THEN** the plugin SHALL resolve it using `serialize().transforms['elevation']` from the system's serialized config

### Requirement: CSS-only HMR in dev mode
HMR geological reset detection SHALL check the system file (single file) instead of separate config and theme files.

#### Scenario: System file change triggers geological reset
- **WHEN** the system definition file (the `system` option path) changes during dev
- **THEN** the plugin SHALL trigger a full geological reset: reload the system via subprocess, rebuild all caches

#### Scenario: Component file change uses cached system
- **WHEN** a non-system file changes during dev
- **THEN** the plugin SHALL use the cached system config (tokens, propConfig, groupRegistry, transforms) — no subprocess

### Requirement: Global styles resolution via standalone subprocess
Global style resolution SHALL use a standalone script (`resolve-global-styles.ts`) instead of inline-generated JavaScript. The script follows the same pattern as `resolve-transforms.ts`.

#### Scenario: Subprocess receives system and theme paths
- **WHEN** `loadSystem()` detects global styles in the serialized config
- **THEN** it SHALL write the theme JSON to a temp file, invoke `resolve-global-styles.ts` with `<system-path> <theme-json-path> <output-file>`, and read the result

#### Scenario: Script handles @keyframes
- **WHEN** global styles contain `@keyframes` selectors
- **THEN** the script SHALL serialize them as raw CSS blocks (nested stops → properties with camelToKebab) without prop config resolution

#### Scenario: Script candidate resolution
- **WHEN** the plugin searches for `resolve-global-styles.ts`
- **THEN** it SHALL check `__pluginDir` (dist), `__pluginDir/../src/`, and package.json-resolved paths

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

When a geological reset occurs (theme, config, or system file change), the plugin SHALL call `clearAnalysisCache()` to clear the Rust-side per-file cache, then run `analyzeProject()` with full file sources (not empty sources). This ensures all files are re-parsed against the updated theme/config/system.

#### Scenario: System file change clears cache
- **WHEN** the system module file changes triggering a geological reset
- **THEN** `clearAnalysisCache()` is called, then `analyzeProject()` re-parses all files from source (cache fully invalidated)

#### Scenario: Geological reset sends full sources
- **WHEN** the cache has been cleared for a geological reset
- **THEN** all file entries include full source text (not empty strings), because cache misses require source for OXC parsing
