## MODIFIED Requirements

### Requirement: Plugin factory function
The plugin factory SHALL accept a `system` option pointing to the module that exports the SystemInstance. Additionally, it SHALL accept optional `targets` (browserslist query string or array), `minify` (boolean), `strict` (boolean), and `packages` (string array) options. The `packages` option lists external package names whose source files are included in extraction file discovery. This replaces `configPath` and `themePath` as separate options.

#### Scenario: System instance path
- **WHEN** consumer configures `animusExtract({ system: './src/ds.ts' })`
- **THEN** the plugin SHALL load that module via a single bun subprocess to obtain tokens, prop config, group registry, and transforms

#### Scenario: Default configuration
- **WHEN** consumer configures `animusExtract()` with no options
- **THEN** the plugin SHALL auto-detect the system module by searching for a file exporting a SystemInstance (same heuristic as current config/theme auto-detection)

#### Scenario: Full configuration with post-processing
- **WHEN** consumer configures `animusExtract({ system: './src/ds.ts', targets: '> 1%', minify: false })`
- **THEN** the plugin SHALL load the system module AND configure CSS post-processing with the specified targets and minification behavior

#### Scenario: External packages included in file discovery
- **WHEN** consumer configures `animusExtract({ system: './src/ds.ts', packages: ['@animus-ui/test-ds'] })`
- **THEN** the plugin SHALL resolve `@animus-ui/test-ds` to its source directory and include those files alongside app files in the `analyzeProject()` call

#### Scenario: Empty packages array is a no-op
- **WHEN** consumer configures `animusExtract({ packages: [] })`
- **THEN** file discovery behaves identically to omitting the `packages` option
