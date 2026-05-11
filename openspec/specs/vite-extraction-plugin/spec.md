## Purpose

Vite plugin that bridges the Rust extraction crate with the build pipeline. Loads the design system via subprocess, runs project analysis, serves extracted CSS via virtual module, and transforms source files.

## Requirements

### Requirement: Plugin factory function

The plugin factory SHALL accept a `system` option pointing to the module that exports the SystemInstance. Additionally, it SHALL accept optional `targets` (browserslist query string or array), `minify` (boolean), `strict` (boolean), `prefix` (string), and `layers` (string array) options. External package discovery is driven by `.includes()` calls in the system file — no explicit `packages` option is needed. System loading SHALL use the `loadSystemModule()` NAPI function (Rust-internal OXC + rquickjs) — no subprocess or runtime detection needed.

#### Scenario: System instance path

- **WHEN** consumer configures `animusExtract({ system: './src/ds.ts' })`
- **THEN** the plugin SHALL load that module via NAPI `loadSystemModule()` to obtain tokens, prop config, group registry, selector aliases, selector order, and global style blocks

#### Scenario: No subprocess or runtime detection

- **WHEN** system loading occurs at buildStart
- **THEN** no `bun` or `node` subprocess SHALL be spawned — `loadSystemModule()` handles file reading, OXC type stripping, dependency resolution, and rquickjs evaluation internally

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
- **THEN** the plugin SHALL trigger a full geological reset: reload the system via `loadSystemModule()` NAPI call, rebuild all caches

#### Scenario: Component file change uses cached system

- **WHEN** a non-system file changes during dev
- **THEN** the plugin SHALL use the cached system config (tokens, propConfig, groupRegistry, transforms) — no system reload

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

### Requirement: Dev server reference stored via configureServer

The plugin SHALL implement a `configureServer` hook that stores the Vite dev server reference in the plugin closure. This reference SHALL be available to other hooks (`transform`, `handleHotUpdate`) for programmatic module invalidation and HMR updates.

#### Scenario: Server reference available during transform

- **WHEN** the dev server is running and a `transform` call needs to invalidate a virtual module
- **THEN** the stored server reference SHALL be available for calling `server.moduleGraph.invalidateModule()` and `server.hot.send()`

#### Scenario: Server reference not set in production

- **WHEN** the plugin runs during a production build (`vite build`)
- **THEN** no `configureServer` hook fires and the server reference SHALL remain `undefined`
- **AND** transform SHALL not attempt CSS invalidation

### Requirement: Verbose timing waterfall display

When verbose mode is enabled, the vite-plugin SHALL display a hierarchical per-phase timing waterfall after extraction completes. The waterfall SHALL nest JS-side phases around Rust-side phases, showing the complete cost decomposition from plugin entry to output.

#### Scenario: Verbose buildStart shows hierarchical breakdown

- **WHEN** `verbose: true` or `ANIMUS_DEBUG=1` is set and `buildStart` completes
- **THEN** the plugin SHALL log a hierarchical waterfall showing JS phases (system-load, file-discovery, file-read+hash, package-resolve, analysis) with the analysis phase decomposed into json-serialize, rust-extract (with nested Rust PipelineTiming phases), and json-parse

#### Scenario: Verbose HMR shows phase breakdown

- **WHEN** verbose mode is enabled and an HMR update triggers re-analysis
- **THEN** the plugin SHALL log the hierarchical waterfall after the HMR timing summary

#### Scenario: Non-verbose mode unchanged

- **WHEN** `verbose` is false and `ANIMUS_DEBUG` is not set
- **THEN** no timing waterfall SHALL be displayed and no `performance.now()` calls SHALL occur (zero-cost gate)

#### Scenario: Transform aggregate reported

- **WHEN** verbose mode is active and a build or HMR cycle completes transforms
- **THEN** the plugin SHALL log a transform summary line with total time, file count, min, max, and average per-file duration

### Requirement: Dead subprocess code removed

The vite-plugin SHALL NOT contain any subprocess-related source files or imports. The `resolve-global-styles.ts` standalone script SHALL be deleted.

#### Scenario: No subprocess files

- **WHEN** the vite-plugin source directory is listed
- **THEN** `resolve-global-styles.ts` SHALL NOT exist

#### Scenario: No subprocess references in comments

- **WHEN** vite-plugin source is searched for "subprocess"
- **THEN** zero matches SHALL be found in source comments (JSDoc and inline)

### Requirement: Fragment-aware HMR splice

In dev mode, the vite-plugin SHALL use per-component CSS fragments from the manifest to enable targeted HMR updates. On file change, only the changed file's component fragments SHALL be replaced in the cached fragment set before re-concatenating affected layers.

#### Scenario: Single file change updates only its fragments

- **WHEN** a file containing 3 components is edited during dev
- **THEN** only those 3 components' fragments SHALL be recomputed via re-analysis
- **AND** fragments for all other components SHALL be preserved from cache

#### Scenario: Extension chain invalidation

- **WHEN** a file containing a parent component is edited
- **THEN** fragments for all descendant components (via reverse_provenance BFS) SHALL also be invalidated and recomputed

### Requirement: Consumer-configurable file-extension list with sensible defaults

The bundler adapter plugins (`@animus-ui/vite-plugin`, `@animus-ui/next-plugin`) SHALL expose a `extensions?: string[]` option on their respective options interfaces (`AnimusExtractOptions`, `AnimusNextOptions`). When the option is undefined, both adapters SHALL default to a shared `DEFAULT_EXTENSIONS` constant exported from `@animus-ui/extract/pipeline`. The default SHALL include `.ts`, `.tsx`, `.js`, `.jsx`, and `.mdx`. Both adapters SHALL import the default from the same source of truth — independent redeclaration SHALL be considered a regression.

Adapter parity: any change to the default extension list lands in one module (`packages/extract/pipeline/mdx-preprocessor.ts`) and propagates to both plugins by import.

#### Scenario: Default extensions include `.mdx`

- **WHEN** a plugin is invoked without an `extensions` option
- **THEN** the plugin's file-discovery walk SHALL include `.ts`, `.tsx`, `.js`, `.jsx`, and `.mdx` files, matching the shared `DEFAULT_EXTENSIONS` constant

#### Scenario: Consumer override replaces the list

- **WHEN** a plugin is invoked with `extensions: ['.ts', '.tsx']`
- **THEN** the file-discovery walk SHALL walk ONLY `.ts` and `.tsx` files — the consumer's list fully replaces the default, no additive merge

#### Scenario: Consumer can add extensions beyond the default

- **WHEN** a plugin is invoked with `extensions: ['.ts', '.tsx', '.js', '.jsx', '.mdx', '.md']`
- **THEN** the file-discovery walk SHALL include `.md` files alongside the default set. The plugin does NOT attempt preprocessing for unknown extensions — `.md` files are handed directly to the scanner (which will skip them as non-JSX) unless a preprocessor for `.md` exists

#### Scenario: Both plugins import the shared constant

- **WHEN** either plugin's source is inspected
- **THEN** the file-discovery walk's default-extension resolution SHALL be `options.extensions ?? DEFAULT_EXTENSIONS` (where `DEFAULT_EXTENSIONS` is imported from `@animus-ui/extract/pipeline`). Neither plugin SHALL carry its own local copy of the default list

### Requirement: File-discovery walk includes `.mdx` sources by default

The bundler adapter plugins SHALL include `.mdx` files in their `buildStart` file-discovery walk alongside existing `.ts`/`.tsx`/`.js`/`.jsx` coverage — via the `DEFAULT_EXTENSIONS` default (see preceding requirement), not as a hardcoded module-local list. MDX files SHALL be pre-processed into scanner-consumable JSX form before being passed to the Rust NAPI `analyzeProject` call. Pre-processing failures on individual files SHALL warn via the plugin's logger (prefix `[animus] ⚠`) and exclude that file from the scanner input, without halting the build.

#### Scenario: `.mdx` files appear in the scanner's input set (default config)

- **WHEN** the vite-plugin's or next-plugin's `buildStart` runs with default options AND `.mdx` files present under the discovery root
- **THEN** those files SHALL be included in the scanner input (after MDX→JSX pre-processing) and their JSX references counted by the usage ledger

#### Scenario: Consumer opt-out via `extensions` override

- **WHEN** a plugin is invoked with `extensions: ['.ts', '.tsx', '.js', '.jsx']` (dropping `.mdx`)
- **THEN** the file-discovery walk SHALL NOT include `.mdx` files, MDX preprocessing SHALL NOT be invoked, and the `@mdx-js/mdx` peer-dep SHALL NOT be dynamically imported (zero install-footprint cost for MDX-free consumers)

#### Scenario: Pre-processing failure does not halt the build

- **WHEN** an individual `.mdx` file fails MDX→JSX pre-processing (malformed frontmatter, invalid JSX, etc.)
- **THEN** the plugin SHALL emit a `[animus] ⚠ MDX preprocessing failed for <file>: <error>` warning via its logger, exclude that file from scanner input, and continue the buildStart with remaining files

#### Scenario: MDX-rendered component extracts in production builds

- **WHEN** `bun run clean:full && bun run verify:build:showcase` completes with MDX files rendering ds-built components (e.g. `<MetricGrid>` in `packages/showcase/src/content/**/*.mdx`)
- **THEN** the resulting `packages/showcase/dist/assets/styles-*.css` SHALL contain the component's CSS rules — `animus-MetricGrid*` selectors SHALL be present

#### Scenario: Adapter-parity via shared constant

- **WHEN** either adapter's default extensions are inspected
- **THEN** the default SHALL trace to the single `DEFAULT_EXTENSIONS` export in `@animus-ui/extract/pipeline`. Parity drift (one plugin's default list differing from the other's) is impossible unless a plugin bypasses the shared import — which SHALL be considered a regression

### Requirement: `@mdx-js/mdx` declared as peer-dep-optional, loaded via dynamic import

The plugin packages SHALL declare `@mdx-js/mdx` in both `peerDependencies` (range `^3.0.0`) AND `peerDependenciesMeta: { "@mdx-js/mdx": { optional: true } }`. The preprocessor module SHALL load `@mdx-js/mdx` via `await import('@mdx-js/mdx').catch(() => null)` — dynamic, with null-fallback on resolution failure.

#### Scenario: Consumer with `.mdx` in extensions and `@mdx-js/mdx` installed

- **WHEN** a consumer has `.mdx` in `options.extensions` (or defaults) AND `@mdx-js/mdx@^3` resolvable in their module graph
- **THEN** MDX files SHALL preprocess and feed to the scanner as expected

#### Scenario: Consumer with `.mdx` in extensions but `@mdx-js/mdx` absent

- **WHEN** a consumer has `.mdx` in `options.extensions` but `@mdx-js/mdx` is NOT resolvable
- **THEN** the plugin SHALL emit a one-shot buildStart warning `[animus] ⚠ .mdx in extensions but @mdx-js/mdx not installed; MDX files skipped` and SHALL continue the build with `.mdx` files excluded from scanner input

#### Scenario: Consumer without `.mdx` in extensions

- **WHEN** a consumer configures `options.extensions` to exclude `.mdx`
- **THEN** the preprocessor SHALL NOT be invoked, `@mdx-js/mdx` SHALL NOT be dynamically imported, and non-MDX consumers SHALL pay zero install footprint cost regardless of whether `@mdx-js/mdx` is resolvable
