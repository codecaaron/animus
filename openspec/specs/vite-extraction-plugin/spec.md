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

### Requirement: Production-only extraction
The plugin SHALL only perform full extraction (file discovery, analyzeProject, source transformation) during production builds. In development mode, the plugin SHALL skip extraction but SHALL still parse theme options and serve CSS variable definitions via the virtual CSS module.

#### Scenario: Production build
- **WHEN** Vite runs in production mode (`vite build`)
- **THEN** the plugin SHALL activate its transform hook and perform extraction

#### Scenario: Development server
- **WHEN** Vite runs in development mode (`vite dev`)
- **THEN** the plugin SHALL not transform any files, but SHALL serve CSS variable definitions via the virtual CSS module if theme variables were provided

#### Scenario: Theme options parsed in both modes
- **WHEN** the plugin runs in dev mode with `theme: { scales, variables }` provided
- **THEN** theme and variable CSS SHALL still be parsed from options, so the virtual CSS module can serve variable definitions even without full extraction

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
The Vite plugin SHALL implement a two-phase build architecture: Phase 1 runs at `buildStart` to produce a UniverseManifest via full-codebase analysis, Phase 2 uses the manifest during per-file `transform` hooks.

#### Scenario: buildStart produces manifest
- **WHEN** Vite runs in production mode and calls `buildStart`
- **THEN** the plugin SHALL: (1) evaluate the theme via `ssrLoadModule()`, (2) serialize config and group registry, (3) glob all source files matching include/exclude patterns, (4) read all file sources, (5) call `analyze_project()` to produce the manifest, (6) store the manifest and its CSS in memory

#### Scenario: transform uses manifest
- **WHEN** a file is processed by the `transform` hook
- **THEN** the plugin SHALL call `transform_file(code, id, manifestJson)` to produce transformed source, rather than calling `extract()` per file

#### Scenario: Development mode remains no-op
- **WHEN** Vite runs in development mode
- **THEN** the plugin SHALL not perform analysis or transformation, leaving Emotion runtime intact

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
The Vite plugin SHALL use CSS module invalidation instead of full page reload when style-related files change during development. React component state SHALL be preserved across style updates.

#### Scenario: Style change triggers CSS-only update
- **WHEN** a developer saves a file containing Animus builder chains
- **THEN** the plugin re-analyzes the project and updates the virtual CSS module
- **THEN** Vite sends a CSS-only HMR update (not full-reload)
- **THEN** the page updates styles without losing React state

#### Scenario: Non-extractable change falls through to full reload
- **WHEN** a file change produces no extractable components (e.g., utility function change)
- **THEN** the plugin falls through to Vite's default HMR behavior
- **THEN** React's normal module replacement handles the update

### Requirement: Content-hash file caching
The Vite plugin SHALL cache file contents by content hash during dev mode. On HMR, only files whose content changed SHALL be re-read from disk.

#### Scenario: Unchanged files are skipped
- **WHEN** a single file is saved during dev mode
- **THEN** only that file is re-read from disk
- **THEN** all other file entries reuse their cached content
- **THEN** the full file entry array is passed to `analyzeProject` with minimal I/O

#### Scenario: Single-file HMR latency
- **WHEN** a single file changes in a 100-file project
- **THEN** the HMR cycle completes in under 50ms
