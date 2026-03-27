## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Plugin factory function
The plugin factory SHALL accept a `system` option pointing to the module that exports the SystemInstance. Additionally, it SHALL accept optional `targets` (browserslist query string or array) and `minify` (boolean) options for CSS post-processing configuration. This replaces `configPath` and `themePath` as separate options.

#### Scenario: System instance path
- **WHEN** consumer configures `animusExtract({ system: './src/ds.ts' })`
- **THEN** the plugin SHALL load that module via a single bun subprocess to obtain tokens, prop config, group registry, and transforms

#### Scenario: Default configuration
- **WHEN** consumer configures `animusExtract()` with no options
- **THEN** the plugin SHALL auto-detect the system module by searching for a file exporting a SystemInstance (same heuristic as current config/theme auto-detection)

#### Scenario: Full configuration with post-processing
- **WHEN** consumer configures `animusExtract({ system: './src/ds.ts', targets: '> 1%', minify: false })`
- **THEN** the plugin SHALL load the system module AND configure CSS post-processing with the specified targets and minification behavior
