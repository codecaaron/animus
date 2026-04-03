## MODIFIED Requirements

### Requirement: Plugin factory function
The plugin factory SHALL accept a `system` option pointing to the module that exports the SystemInstance. Additionally, it SHALL accept optional `targets` (browserslist query string or array) and `minify` (boolean) options for CSS post-processing configuration. This replaces `configPath` and `themePath` as separate options. The subprocess model SHALL detect the available runtime (bun preferred, node fallback) rather than hardcoding `bun run`.

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

## ADDED Requirements

### Requirement: EmitterConfig construction
The Vite plugin SHALL construct an `EmitterConfig` with default values (`runtime_import: '@animus-ui/system'`, `css_module_id: 'virtual:animus/styles.css'`) and pass it to `analyzeProject()`.

#### Scenario: Backward-compatible defaults
- **WHEN** the Vite plugin calls `analyzeProject()`
- **THEN** it SHALL include emitter config JSON with the existing default import source and virtual CSS module ID
- **AND** the transformed output SHALL be identical to the current behavior
