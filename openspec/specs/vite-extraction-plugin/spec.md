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

---

### Requirement: System prop map virtual module
The Vite plugin SHALL serve a virtual module at `virtual:animus/system-props` that exports the shared system prop map, system prop groups, dynamic prop configuration, and transform functions. The dynamic prop configuration and transforms SHALL only be included when dynamic prop usage is detected.

#### Scenario: Resolve virtual module ID
- **WHEN** a source file imports `from 'virtual:animus/system-props'`
- **THEN** the plugin's `resolveId` hook SHALL resolve it to an internal virtual module ID (e.g., `\0virtual:animus/system-props`)

#### Scenario: Load virtual module with dynamic props
- **WHEN** the extraction detected dynamic usage for props `p` and `borderRadius` with `borderRadius` having a `size` transform
- **THEN** the plugin's `load` hook SHALL return exports including `systemPropMap`, `systemPropGroups`, `dynamicPropConfig`, and `transforms` — with `transforms` containing only the `size` function

#### Scenario: Load virtual module without dynamic props
- **WHEN** no dynamic prop usage was detected across the project
- **THEN** the plugin's `load` hook SHALL return exports including only `systemPropMap` and `systemPropGroups` — `dynamicPropConfig` and `transforms` SHALL NOT be exported

#### Scenario: Module available during dev
- **WHEN** the Vite dev server is running
- **THEN** `virtual:animus/system-props` SHALL be resolvable and serve the current data from the most recent extraction

#### Scenario: Module available during build
- **WHEN** `vite build` runs in production mode
- **THEN** `virtual:animus/system-props` SHALL be resolvable and serve data from the full-project extraction

### Requirement: System prop map HMR invalidation
During dev mode, the plugin SHALL invalidate the `virtual:animus/system-props` module ONLY when the system prop map content changes between extraction runs.

#### Scenario: Map changed after file edit
- **WHEN** a file edit causes re-extraction and the resulting system prop map differs from the cached version
- **THEN** the plugin SHALL invalidate the `virtual:animus/system-props` module in Vite's module graph, triggering HMR for all importing modules

#### Scenario: Map unchanged after file edit
- **WHEN** a file edit causes re-extraction but the system prop map is identical to the cached version
- **THEN** the plugin SHALL NOT invalidate the `virtual:animus/system-props` module — no unnecessary HMR propagation

#### Scenario: Geological reset invalidates map
- **WHEN** the system definition file changes (triggering a full geological reset with theme/scale reload)
- **THEN** the plugin SHALL re-extract, generate a new system prop map, and invalidate the virtual module if the map changed

### Requirement: Transform function serialization in virtual module

The plugin SHALL serialize transform functions used by dynamic props (both system and custom) into the `virtual:animus/system-props` module as the `transforms` export. Each transform is serialized using `Function.prototype.toString()`. Only transforms actually referenced by dynamic prop configurations (system or custom) SHALL be included.

When custom props reference transforms (via `transformName` in their `PropConfig`), those transform functions SHALL be included in the shared `transforms` export alongside system prop transforms. The transforms are shared by name — the same `size` transform used by system props and custom props is serialized once.

#### Scenario: System prop transform serialized
- **WHEN** a system prop has dynamic usage and references transform `size`
- **THEN** the `transforms` export includes `size` serialized via `Function.prototype.toString()`

#### Scenario: Custom prop transform serialized
- **WHEN** a custom prop has dynamic usage and its `PropConfig` specifies `transform: 'size'`
- **THEN** the `transforms` export includes `size` (shared with system props if both use it)

#### Scenario: Custom-only transform serialized
- **WHEN** a custom prop references a transform not used by any system prop (e.g., a user-defined transform)
- **THEN** the `transforms` export includes that transform function

#### Scenario: No dynamic usage means no transform serialized
- **WHEN** a custom prop has a transform in its config but only static usage detected
- **THEN** that transform is NOT included in the `transforms` export

### Requirement: Dynamic prop config in virtual module

The `virtual:animus/system-props` module SHALL export `dynamicPropConfig` containing metadata for system props with dynamic usage. This config is shared across all components.

Custom prop dynamic config SHALL NOT be included in the virtual module. Custom dynamic config is per-component and is inlined in each component's `createComponent` config object by the transform emitter.

#### Scenario: System dynamic config in virtual module
- **WHEN** system props have dynamic usage detected
- **THEN** `dynamicPropConfig` is exported from `virtual:animus/system-props`

#### Scenario: Custom dynamic config NOT in virtual module
- **WHEN** custom props have dynamic usage detected
- **THEN** `dynamicPropConfig` does NOT include custom prop entries — they are inlined per-component

#### Scenario: Both system and custom dynamic props
- **WHEN** both system and custom props have dynamic usage
- **THEN** `dynamicPropConfig` contains only system prop entries; custom entries are in per-component config objects

### Requirement: Custom prop transform discovery

During `buildStart` analysis, the plugin SHALL discover transform references from custom prop configs in the manifest. For each component with custom props that have dynamic usage, the plugin SHALL check the component's custom prop config for `transform_name` fields and include those transforms in the serialization set.

Transform discovery SHALL iterate all components in the manifest, not just system prop configs. This ensures custom-prop-only transforms (not used by any system prop) are still serialized.

#### Scenario: Transform used only by custom props
- **WHEN** a custom prop references transform `borderShorthand` but no system prop uses it dynamically
- **THEN** `borderShorthand` is still serialized in the `transforms` export

#### Scenario: No custom props with transforms
- **WHEN** no custom props reference any transforms
- **THEN** transform discovery is unchanged from pre-change behavior (system props only)
