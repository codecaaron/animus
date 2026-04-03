## Purpose

Vite plugin that bridges the Rust extraction crate with the build pipeline. Loads the design system via subprocess, runs project analysis, serves extracted CSS via virtual module, and transforms source files.

## Requirements

### Requirement: Plugin factory function
The plugin factory SHALL accept a `system` option pointing to the module that exports the SystemInstance. Additionally, it SHALL accept optional `targets` (browserslist query string or array), `minify` (boolean), `strict` (boolean), `prefix` (string), and `layers` (string array) options. External package discovery is driven by `.includes()` calls in the system file — no explicit `packages` option is needed. This replaces `configPath` and `themePath` as separate options. The subprocess model SHALL detect the available runtime (bun preferred, node fallback) rather than hardcoding `bun run`.

#### Scenario: System instance path
- **WHEN** consumer configures `animusExtract({ system: './src/ds.ts' })`
- **THEN** the plugin SHALL load that module via a subprocess (using bun if available, node otherwise) to obtain tokens, prop config, group registry, and transforms

#### Scenario: Default configuration
- **WHEN** consumer configures `animusExtract()` with no options
- **THEN** the plugin SHALL auto-detect the system module by searching for a file exporting a SystemInstance (same heuristic as current config/theme auto-detection)

#### Scenario: Full configuration with post-processing
- **WHEN** consumer configures `animusExtract({ system: './src/ds.ts', targets: '> 1%', minify: false })`
- **THEN** the plugin SHALL load the system module AND configure CSS post-processing with the specified targets and minification behavior

#### Scenario: Node fallback when bun unavailable
- **WHEN** `bun` is not found in the system PATH
- **THEN** the plugin SHALL use `node` to execute subprocess scripts with CJS-compatible require() syntax

#### Scenario: External packages discovered from .includes()
- **WHEN** the system file contains `.includes([testDs])` with `import { ds as testDs } from '@animus-ui/test-ds'`
- **THEN** the plugin SHALL discover `@animus-ui/test-ds`, resolve it, and include its source files in extraction

#### Scenario: No .includes() means no external packages
- **WHEN** the system file has no `.includes()` call
- **THEN** no external packages are discovered — only app source files are extracted

### Requirement: External package module resolution redirect
For discovered external packages with a `src/index.ts`, the plugin SHALL redirect module resolution so the bundler serves source files instead of dist files. This ensures the transform hook processes `.ts` source (with builder chains) rather than `.mjs` dist (which fails extension filters).

#### Scenario: Vite resolveId redirect
- **WHEN** `@animus-ui/test-ds` has `src/index.ts` and the Vite dev server or build resolves the specifier
- **THEN** the plugin's `resolveId` hook returns the absolute path to `src/index.ts`

#### Scenario: Webpack NormalModuleReplacement redirect
- **WHEN** `@animus-ui/test-ds` has `src/index.ts` and webpack resolves the specifier
- **THEN** the `NormalModuleReplacementPlugin` `beforeResolve` hook rewrites the request to `src/index.ts`

#### Scenario: No src/ — no redirect
- **WHEN** a discovered package does NOT have `src/` (npm-installed, dist only)
- **THEN** no redirect occurs — the bundler resolves to dist normally

### Requirement: External package transform/loader exemption
Files under discovered external package directories SHALL bypass extension filters and node_modules exclusion in the transform hook (Vite) and loader rule (Next/webpack). The manifest check is the authoritative gatekeeper.

#### Scenario: Vite transform processes external package files
- **WHEN** a file's path starts with an external package directory prefix
- **THEN** the transform hook skips the `\.[jt]sx?$` extension check and the `node_modules` guard — the manifest check alone determines whether to transform

#### Scenario: Webpack loader processes external package files
- **WHEN** a file's path starts with an external package directory prefix
- **THEN** the loader's `test` function accepts `.mjs` files and the `exclude` function allows files inside `node_modules`

#### Scenario: Non-external node_modules still excluded
- **WHEN** a file is in `node_modules` but NOT under any external package directory
- **THEN** the standard `node_modules` exclusion applies

### Requirement: External package HMR in dev mode
In dev mode, edits to workspace-linked external package files SHALL trigger the HMR handler. The `node_modules` exclude pattern in the HMR handler SHALL be bypassed for files under external package directories.

#### Scenario: Workspace-linked package file change triggers HMR
- **WHEN** a file in a workspace-linked external package changes during dev
- **THEN** the HMR handler SHALL process it: content-hash check, re-analysis, module invalidation

#### Scenario: Non-external node_modules changes still excluded
- **WHEN** a file in `node_modules/react` changes
- **THEN** the HMR handler SHALL skip it via the standard exclude pattern

### Requirement: Theme evaluation at build start
Theme evaluation SHALL use the theme's `.serialize()` method when available. The plugin SHALL load the system module once at `buildStart` via subprocess, call `tokens.serialize()` and `ds.serialize()`, and hold the results in memory.

#### Scenario: Modern theme with serialize method
- **WHEN** the loaded theme object has a `.serialize()` method
- **THEN** the plugin SHALL call `theme.serialize()` to obtain `{ scalesJson, variableMapJson, variableCss, contextualVarsJson }`

#### Scenario: Legacy theme without serialize method
- **WHEN** the loaded theme object does NOT have a `.serialize()` method
- **THEN** the plugin SHALL fall back to the local legacy evaluation path

### Requirement: Post-processing utilities imported from extract
The plugin SHALL import post-processing utilities from `@animus-ui/extract/pipeline` instead of implementing them locally. The plugin calls `analyzeProject()` directly for NAPI analysis, then composes extract's pipeline utilities for post-processing.

#### Scenario: Unit fallback via extract
- **WHEN** extracted CSS needs unit fallback
- **THEN** the plugin SHALL import and call `applyUnitFallback` from `@animus-ui/extract/pipeline`

#### Scenario: Prefix application via extract
- **WHEN** CSS variables need namespace prefixing
- **THEN** the plugin SHALL import and call `applyPrefix` from `@animus-ui/extract/pipeline`

#### Scenario: Global styles resolved via extract
- **WHEN** global style blocks are discovered during system loading
- **THEN** the subprocess SHALL import `resolveGlobalStyles` from `@animus-ui/extract/pipeline` for resolution

#### Scenario: NAPI called directly
- **WHEN** the plugin runs analysis during buildStart
- **THEN** it SHALL call `analyzeProject()` from `@animus-ui/extract` directly — not through an intermediary wrapper

### Requirement: Transform post-processing via subprocess
Transform post-processing SHALL use a subprocess to resolve `__TRANSFORM__` placeholders. This is a host concern — transform functions require the system module loaded in a subprocess for ESM isolation, and cannot be delegated to the extract pipeline.

#### Scenario: Transform resolution via subprocess
- **WHEN** extracted CSS contains `__TRANSFORM__` placeholders
- **THEN** the plugin SHALL resolve them by executing live transform functions in a subprocess

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

### Requirement: Plugin accepts browser target configuration
The `animusExtract()` plugin factory SHALL accept optional `targets` and `minify` configuration options for CSS post-processing.

#### Scenario: Explicit browserslist targets
- **WHEN** consumer configures `animusExtract({ system: './src/ds.ts', targets: '> 1%, last 2 versions' })`
- **THEN** the plugin SHALL use those browserslist queries to derive Lightning CSS browser targets

#### Scenario: Array of browserslist queries
- **WHEN** consumer configures `animusExtract({ targets: ['> 1%', 'not dead'] })`
- **THEN** the plugin SHALL combine the queries to derive browser targets

#### Scenario: No explicit targets — browserslist auto-detection
- **WHEN** consumer configures `animusExtract()` with no `targets` option
- **THEN** the plugin SHALL auto-detect browserslist config from the project (`.browserslistrc`, `package.json#browserslist`, `BROWSERSLIST` env var)

#### Scenario: No browserslist config found — defaults
- **WHEN** no explicit targets and no browserslist config is found in the project
- **THEN** the plugin SHALL use `defaults` as the browserslist query (equivalent to `> 0.5%, last 2 versions, Firefox ESR, not dead`)

#### Scenario: Explicit minify override
- **WHEN** consumer configures `animusExtract({ minify: true })`
- **THEN** CSS SHALL be minified in both dev and prod modes regardless of the default behavior

#### Scenario: Explicit minify disable
- **WHEN** consumer configures `animusExtract({ minify: false })`
- **THEN** CSS SHALL NOT be minified in any mode (autoprefixing still applies)

### Requirement: Post-processing in virtual module load hooks
The plugin's `load()` hook SHALL run CSS through Lightning CSS post-processing before returning content for virtual modules. This applies to all virtual modules that serve CSS content.

#### Scenario: Production styles.css post-processed
- **WHEN** `virtual:animus/styles.css` is loaded during a production build
- **THEN** the concatenated CSS (variables + globals + component CSS) SHALL be post-processed with minification and autoprefixing before being returned

#### Scenario: Dev styles.css post-processed
- **WHEN** `virtual:animus/styles.css` is loaded during dev server
- **THEN** the CSS (layer declaration + variables + globals) SHALL be post-processed with autoprefixing only (no minification) before being returned

#### Scenario: Dev component CSS post-processed
- **WHEN** `virtual:animus/components.js` is loaded during dev server
- **THEN** the component CSS string (exported as JS template literal) SHALL be post-processed with autoprefixing only before being embedded in the JS module

#### Scenario: HMR update CSS post-processed
- **WHEN** a file change triggers HMR and new component CSS is generated
- **THEN** the updated component CSS SHALL be post-processed before being served via the HMR bridge

### Requirement: Post-processing pipeline order
Lightning CSS post-processing SHALL be the LAST step in the CSS post-processing chain, after transform placeholder resolution and unit fallback.

#### Scenario: Transform resolution before Lightning CSS
- **WHEN** CSS contains `__TRANSFORM__[size](0.5)__` placeholders
- **THEN** transforms are resolved first, then the fully-resolved CSS is passed to Lightning CSS

#### Scenario: Unit fallback before Lightning CSS
- **WHEN** CSS contains bare numeric values that need px suffixing
- **THEN** unit fallback is applied first, then the corrected CSS is passed to Lightning CSS

### Requirement: Target resolution at plugin initialization
Browser targets SHALL be resolved once during plugin `configResolved` or `buildStart`, not on every CSS processing call. The resolved targets are held in closure for the duration of the build.

#### Scenario: Targets resolved once
- **WHEN** the plugin initializes with `targets: '> 1%'`
- **THEN** the browserslist query is resolved to Lightning CSS targets once and cached

#### Scenario: Targets available for all virtual modules
- **WHEN** multiple virtual modules are loaded during a build
- **THEN** all use the same pre-resolved targets without re-computing

### Requirement: Strict mode subprocess error propagation
When the plugin is configured with `strict: true`, subprocess failures in `loadSystem()`, `resolveGlobalStyles()`, and `resolveTransforms()` SHALL throw errors that halt the build. When `strict` is `false` or omitted, the default behavior (log a warning and continue) is preserved.

#### Scenario: Strict mode — loadSystem failure throws
- **WHEN** the plugin is configured with `strict: true` and the system subprocess exits with a non-zero code or produces an error
- **THEN** the plugin SHALL throw an error, halting the Vite build with a descriptive message

#### Scenario: Strict mode — resolveGlobalStyles failure throws
- **WHEN** the plugin is configured with `strict: true` and the global-styles subprocess fails
- **THEN** the plugin SHALL throw an error rather than logging a warning and continuing

#### Scenario: Strict mode — resolveTransforms failure throws
- **WHEN** the plugin is configured with `strict: true` and the transforms subprocess fails
- **THEN** the plugin SHALL throw an error rather than logging a warning and continuing

#### Scenario: Default mode — subprocess failure logs warning
- **WHEN** the plugin is configured without `strict` (or `strict: false`) and any subprocess fails
- **THEN** the plugin SHALL log a warning and continue — no error is thrown, existing behavior is unchanged

### Requirement: Scoped build-time state (no bare globalThis keys)
The plugin SHALL NOT use bare `globalThis` keys for any build-time state. All build-time state (system cache, file cache, analysis results, transform registry) SHALL be held in closure-scoped variables within the plugin factory function. HMR state keys that must persist across Vite's internal module re-evaluations SHALL be namespaced with a hash derived from the system module path to prevent collisions when multiple plugin instances are active.

#### Scenario: Plugin factory uses closure scope
- **WHEN** the `animusExtract()` factory is called
- **THEN** all mutable build-time state (loaded system, file cache, prop map cache) SHALL be declared as `let` / `const` variables inside the factory closure — not attached to `globalThis`

#### Scenario: No bare globalThis assignment
- **WHEN** any plugin code runs (buildStart, load, transform, handleHotUpdate)
- **THEN** no code SHALL assign to `globalThis.<unprefixed_key>` for build-time bookkeeping

#### Scenario: HMR state namespaced by system path hash
- **WHEN** two plugin instances are instantiated with different `system` paths in the same Vite process
- **THEN** any HMR-related state that must survive module re-evaluation SHALL use keys namespaced with a hash of the respective system module path, ensuring the instances do not share or overwrite each other's state

### Requirement: EmitterConfig construction
The Vite plugin SHALL construct an `EmitterConfig` with default values (`runtime_import: '@animus-ui/system'`, `css_module_id: 'virtual:animus/styles.css'`) and pass it to `analyzeProject()`.

#### Scenario: Backward-compatible defaults
- **WHEN** the Vite plugin calls `analyzeProject()`
- **THEN** it SHALL include emitter config JSON with the existing default import source and virtual CSS module ID
- **AND** the transformed output SHALL be identical to the current behavior
