### Requirement: Plugin factory function
The Vite plugin SHALL be exported as `animusExtract(options?) -> Plugin` from `@animus-ui/vite-plugin`. The `theme` option SHALL accept TWO forms: a pre-serialized flat JSON string (legacy, no CSS variable emission) or an object `{ scales: string; variables: string }` containing pre-evaluated scales JSON and CSS variable declarations. Theme evaluation (via `evaluateTheme` or other means) is the CALLER's responsibility.

#### Scenario: Default configuration
- **WHEN** `animusExtract()` is called with no options
- **THEN** the plugin SHALL use an empty theme JSON `'{}'` (no variable emission)

#### Scenario: Pre-serialized theme JSON (legacy)
- **WHEN** `animusExtract({ theme: '{"colors.primary": "#6366f1"}' })` is called with a JSON string
- **THEN** the plugin SHALL use it directly as the flattened theme with no CSS variable emission (backward compatible)

#### Scenario: Pre-evaluated theme with variables
- **WHEN** `animusExtract({ theme: { scales: '{"colors.primary": "var(--color-primary)"}', variables: ':root { --color-primary: #6366f1; }' } })` is called
- **THEN** the plugin SHALL use `scales` as the flattened theme for the Rust pipeline and `variables` as CSS to prepend to the virtual stylesheet

### Requirement: CSS output includes theme variables
The virtual CSS module (`virtual:animus/styles.css`) SHALL prepend theme variable CSS (`:root` definitions and `[data-color-mode]` overrides) before the component CSS when variable definitions are available.

#### Scenario: Virtual module with theme variables
- **WHEN** the plugin has theme variables and extracted component CSS
- **THEN** the virtual CSS module content SHALL be `variableCss + componentCss`

#### Scenario: Virtual module without theme variables
- **WHEN** the plugin uses a pre-serialized JSON theme (no `_variables` available)
- **THEN** the virtual CSS module content SHALL contain only the component CSS

#### Scenario: Dev mode serves variable CSS
- **WHEN** the plugin runs in dev mode with `theme: { scales, variables }` provided
- **THEN** the virtual CSS module SHALL serve the variable CSS even though component extraction is skipped

### Requirement: Theme evaluation at build start
The plugin SHALL evaluate the theme module at `buildStart` using Vite's `ssrLoadModule()`. It SHALL flatten all theme scales into a JSON map of `{ "scale_name.key": "css_value" }` format and hold it in memory for passing to the Rust `extract()` function.

#### Scenario: Theme with computed scales
- **WHEN** the theme uses `.addScale('shadows', ({ colors }) => ({...}))` with function-based scale definitions
- **THEN** the plugin SHALL evaluate the full theme build chain, resolving all function-based scales to their final values, and include them in the flattened JSON map

#### Scenario: Theme with color modes
- **WHEN** the theme uses `.addColorModes()` generating CSS custom properties
- **THEN** the flattened map SHALL contain CSS variable references (e.g., `"colors.background": "var(--colors-background)"`) rather than raw color values

### Requirement: Prop config serialization
The plugin SHALL serialize the prop configuration from `@animus-ui/core` into a JSON map at build start. Each prop entry SHALL include `property`, `properties` (if multi-property), `scale` (if theme-linked), and `transform` (as a string identifier derived from `.transformName ?? .name`, or omitted if not available).

#### Scenario: Serialize prop with scale and transform
- **WHEN** config has `borderRadius: { property: 'borderRadius', scale: 'radii', transform: size }` where `size.transformName === 'size'`
- **THEN** the serialized entry SHALL be `{ "property": "borderRadius", "scale": "radii", "transform": "size" }`

#### Scenario: Serialize multi-property prop
- **WHEN** config has `px: { property: 'padding', properties: ['paddingLeft', 'paddingRight'], scale: 'space' }`
- **THEN** the serialized entry SHALL include both `property` and `properties` array

#### Scenario: Serialize prop with unnamed transform
- **WHEN** config has `width: { property: 'width', transform: (v) => v }` (anonymous function, no `.transformName`, `.name === ''`)
- **THEN** the serialized entry SHALL NOT include a `transform` field — the transform is only available at runtime

### Requirement: NAPI function signature change
The plugin SHALL pass a fifth argument `group_registry_json` to the Rust `extract()` function. This JSON maps group names to arrays of prop names, enabling the Rust pipeline to resolve which props belong to which groups.

#### Scenario: Serialize group registry
- **WHEN** the config has groups `space: ["p", "px", "py", "pt", "m", "mx", ...]` and `layout: ["display", "width", "height", ...]`
- **THEN** the plugin SHALL serialize the group registry to JSON: `{ "space": ["p", "px", "py", "pt", "m", "mx", ...], "layout": ["display", "width", "height", ...] }`

#### Scenario: Pass to extract function
- **WHEN** the transform hook calls the Rust `extract()` function
- **THEN** it SHALL pass `(source, filename, theme_json, config_json, group_registry_json)` — five arguments

### Requirement: Group registry serialization at build start
The plugin SHALL serialize the group registry from `@animus-ui/core/config` at `buildStart` alongside the existing theme and prop config serialization. The group registry SHALL map each group name to an array of its constituent prop names.

#### Scenario: Group registry from config
- **WHEN** config defines groups via `createAnimus().addGroup('space', spaceProps).addGroup('layout', layoutProps).build()`
- **THEN** the group registry SHALL be `{ "space": ["p", "px", "py", "pt", "pr", "pb", "pl", "m", "mx", "my", "mt", "mr", "mb", "ml"], "layout": ["display", "width", "height", "minWidth", "minHeight", "maxWidth", "maxHeight", "overflow", "overflowX", "overflowY", "verticalAlign"] }` (exact prop names from the group definitions)

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

### Requirement: Single global CSS output
The plugin SHALL emit a single virtual CSS module (`virtual:animus/styles.css`) containing ALL extracted CSS from the manifest. Per-file virtual CSS modules are no longer used.

#### Scenario: Global CSS module resolution
- **WHEN** transformed source imports `virtual:animus/styles.css`
- **THEN** the plugin's `resolveId` hook SHALL resolve it and the `load` hook SHALL serve the manifest's complete CSS string

#### Scenario: No duplicate @layer declarations
- **WHEN** multiple files are transformed
- **THEN** the `@layer base, variants, states, system, custom;` declaration SHALL appear exactly ONCE in the global CSS output (from the manifest), not once per file

#### Scenario: CSS import in transformed files
- **WHEN** a file has extracted components
- **THEN** the transformed source SHALL import `virtual:animus/styles.css` — all files share one CSS import path

### Requirement: File discovery via glob
The plugin SHALL discover source files to analyze using configurable glob patterns. The default SHALL include `**/*.{ts,tsx,js,jsx}` within the project root, excluding `node_modules`, `dist`, and test directories.

#### Scenario: Default glob
- **WHEN** `animusExtract()` is called with no `include` option
- **THEN** the plugin SHALL scan `**/*.{ts,tsx,js,jsx}` in the project root, excluding `node_modules/**` and `dist/**`

#### Scenario: Custom include/exclude
- **WHEN** `animusExtract({ include: ['src/**/*.tsx'], exclude: ['src/**/*.test.tsx'] })` is called
- **THEN** the plugin SHALL only analyze files matching `src/**/*.tsx` that don't match `src/**/*.test.tsx`

### Requirement: Package import discovery and resolution
The Vite plugin SHALL discover package-name imports in the analyzed source files, resolve them using Vite's `this.resolve()` API, include the resolved package source files in the analysis, and pass a package resolution map to `analyze_project`.

#### Scenario: Discover animus package imports
- **WHEN** source files contain `import { Box } from '@animus-ui/components'`
- **AND** `packagePatterns` includes `@animus-ui/*`
- **THEN** the plugin SHALL detect the package specifier `@animus-ui/components` as requiring resolution

#### Scenario: Resolve package to entry file
- **WHEN** the plugin discovers `@animus-ui/components` needs resolution
- **THEN** it SHALL call `this.resolve('@animus-ui/components')` to get the absolute file path of the package entry, and record the mapping

#### Scenario: Include package source tree
- **WHEN** `@animus-ui/components` resolves to `packages/ui/src/index.ts`
- **THEN** the plugin SHALL discover all `.ts`/`.tsx` files in `packages/ui/src/` and include them in the file entries passed to `analyze_project`

#### Scenario: Pass resolution map to analyzer
- **WHEN** the plugin has resolved package specifiers
- **THEN** it SHALL call `analyzeProject(fileEntriesJson, themeJson, configJson, groupRegistryJson, packageResolutionJson)` with the resolution map as the 5th argument

#### Scenario: Custom package patterns
- **WHEN** `animusExtract({ packagePatterns: ['@mydesign/*'] })` is configured
- **THEN** the plugin SHALL resolve imports matching `@mydesign/*` instead of the default `@animus-ui/*`

#### Scenario: External packages ignored
- **WHEN** source files import from `react`, `next/link`, or other packages NOT matching the configured patterns
- **THEN** the plugin SHALL NOT attempt to resolve those imports — they are external

### Requirement: Plugin options for package resolution
The `AnimusExtractOptions` interface SHALL include a `packagePatterns` field (type: `string[]`, default: `['@animus-ui/*']`) that controls which package imports trigger resolution.

#### Scenario: Default patterns
- **WHEN** `animusExtract()` is called with no `packagePatterns` option
- **THEN** the plugin SHALL use `['@animus-ui/*']` as the default pattern set

#### Scenario: Override patterns
- **WHEN** `animusExtract({ packagePatterns: ['@mydesign/*', '@myutil/*'] })` is called
- **THEN** only imports matching `@mydesign/*` or `@myutil/*` SHALL be resolved

### Requirement: Smoke test TypeScript configuration
The smoke test package SHALL have a `tsconfig.json` extending the root config with `jsx: "react-jsx"` and `noEmit: true`, and a `typecheck` script in `package.json` that runs `tsc --noEmit`.

#### Scenario: tsconfig resolves workspace packages
- **WHEN** `tsc --noEmit` runs in the smoke test
- **THEN** it SHALL resolve `@animus-ui/core` and `@animus-ui/runtime` imports via the workspace (path aliases or Bun workspace resolution) and type-check against their source types

#### Scenario: typecheck script is runnable
- **WHEN** a developer runs `bun run typecheck` in `packages/smoke-test/`
- **THEN** `tsc --noEmit` SHALL execute and report any type errors in `src/**/*.tsx`

### Requirement: Transform post-processing
The Vite plugin SHALL apply transform functions to the Rust pipeline's intermediate output as a JS post-processing step. After `analyze_project()` returns a manifest containing raw values and transform metadata, the plugin SHALL resolve each transform name to the actual JS function from the loaded config and apply it to produce final CSS values.

#### Scenario: Post-process size transform
- **WHEN** the manifest contains a declaration `{ property: "width", transform: "size", raw_value: 1 }`
- **THEN** the plugin SHALL look up the `size` function from the config, call `size(1)`, and replace the raw value with `"100%"` in the final CSS

#### Scenario: Post-process borderShorthand transform
- **WHEN** the manifest contains a declaration `{ property: "border", transform: "borderShorthand", raw_value: 2 }`
- **THEN** the plugin SHALL call `borderShorthand(2)` and replace the raw value with `"2px solid currentColor"` in the final CSS

#### Scenario: Post-process custom transform
- **WHEN** the manifest contains `{ property: "font-size", transform: "fluid", raw_value: 16 }` and the loaded config includes a transform named `"fluid"`
- **THEN** the plugin SHALL call the `fluid` function with `16` and substitute the result into the final CSS

#### Scenario: Unknown transform name produces warning
- **WHEN** the manifest contains a transform name that does not match any function in the loaded config
- **THEN** the plugin SHALL emit a warning in the extraction report and use the raw value as-is

### Requirement: Transform registry built from config
The Vite plugin SHALL build a transform registry (`Map<string, TransformFn>`) from the loaded config module at `buildStart`. The registry maps transform names (from `.transformName` properties) to the actual JS functions.

#### Scenario: Registry from default config
- **WHEN** the plugin loads `@animus-ui/core` config at build start
- **THEN** the transform registry SHALL contain entries for `'size'`, `'borderShorthand'`, `'gridItemRatio'`, and `'gridItem'`

#### Scenario: Registry from custom config
- **WHEN** the plugin loads a custom config that includes `createTransform('fluid', fn)`
- **THEN** the transform registry SHALL contain `'fluid'` in addition to any built-in transforms

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
