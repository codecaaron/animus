### Requirement: Plugin factory function
The Vite plugin SHALL be exported as `animusExtract(options?) -> Plugin` from `@animus-ui/vite-plugin`. The options object MAY include `theme` (path to theme module, default auto-detected), `config` (path to prop config module, default `@animus-ui/core/config`), and `include`/`exclude` globs for file filtering.

#### Scenario: Default configuration
- **WHEN** `animusExtract()` is called with no options
- **THEN** the plugin SHALL auto-detect the theme module by searching for `theme.ts` or `theme.js` in the project root and src directory

#### Scenario: Custom theme path
- **WHEN** `animusExtract({ theme: './src/design/theme.ts' })` is called
- **THEN** the plugin SHALL use the specified path for theme evaluation

### Requirement: Production-only activation
The plugin SHALL only perform extraction during production builds. In development mode, the plugin SHALL be a no-op, allowing Emotion runtime to function as-is.

#### Scenario: Production build
- **WHEN** Vite runs in production mode (`vite build`)
- **THEN** the plugin SHALL activate its transform hook and perform extraction

#### Scenario: Development server
- **WHEN** Vite runs in development mode (`vite dev`)
- **THEN** the plugin SHALL not transform any files, leaving Emotion runtime intact

### Requirement: Theme evaluation at build start
The plugin SHALL evaluate the theme module at `buildStart` using Vite's `ssrLoadModule()`. It SHALL flatten all theme scales into a JSON map of `{ "scale_name.key": "css_value" }` format and hold it in memory for passing to the Rust `extract()` function.

#### Scenario: Theme with computed scales
- **WHEN** the theme uses `.addScale('shadows', ({ colors }) => ({...}))` with function-based scale definitions
- **THEN** the plugin SHALL evaluate the full theme build chain, resolving all function-based scales to their final values, and include them in the flattened JSON map

#### Scenario: Theme with color modes
- **WHEN** the theme uses `.addColorModes()` generating CSS custom properties
- **THEN** the flattened map SHALL contain CSS variable references (e.g., `"colors.background": "var(--colors-background)"`) rather than raw color values

### Requirement: Prop config serialization
The plugin SHALL serialize the prop configuration from `@animus-ui/core/config` into a JSON map at build start. Each prop entry SHALL include `property`, `properties` (if multi-property), `scale` (if theme-linked), and `transform` (as a string identifier: `"size"`, `"borderShorthand"`, `"gridItemRatio"`, or `null`).

#### Scenario: Serialize prop with scale and transform
- **WHEN** config has `borderRadius: { property: 'borderRadius', scale: 'radii', transform: size }`
- **THEN** the serialized entry SHALL be `{ "property": "borderRadius", "scale": "radii", "transform": "size" }`

#### Scenario: Serialize multi-property prop
- **WHEN** config has `px: { property: 'padding', properties: ['paddingLeft', 'paddingRight'], scale: 'space' }`
- **THEN** the serialized entry SHALL include both `property` and `properties` array

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
