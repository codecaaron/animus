## MODIFIED Requirements

### Requirement: Plugin factory function
The plugin factory SHALL accept a `system` option pointing to the module that exports the SystemInstance. It SHALL also accept an optional `runtimePackage` option (default: `'@animus-ui/react'`) that controls the runtime import path emitted by the Rust transform emitter. This replaces `configPath` and `themePath` as separate options.

#### Scenario: System instance path
- **WHEN** consumer configures `animusExtract({ system: './src/ds.ts' })`
- **THEN** the plugin SHALL load that module via a single bun subprocess to obtain tokens, prop config, group registry, and transforms

#### Scenario: Default configuration
- **WHEN** consumer configures `animusExtract()` with no options
- **THEN** the plugin SHALL auto-detect the system module by searching for a file exporting a SystemInstance (same heuristic as current config/theme auto-detection)

#### Scenario: Custom runtime package
- **WHEN** consumer configures `animusExtract({ runtimePackage: '@my-org/animus-react' })`
- **THEN** the Rust transform emitter SHALL emit `import { createComponent } from '@my-org/animus-react'` instead of the default

#### Scenario: Default runtime package
- **WHEN** no `runtimePackage` option is provided
- **THEN** the default import path SHALL be `'@animus-ui/react'`

### Requirement: Configurable transform emitter paths
The plugin SHALL pass runtime import path and CSS module ID to the Rust crate via the manifest config, rather than relying on hardcoded values in `transform_emitter.rs`.

#### Scenario: Manifest includes emitter config
- **WHEN** the plugin calls `analyze_project()` or constructs the manifest for `transform_file()`
- **THEN** the manifest JSON SHALL include a `config` object with `runtimeImport` and `cssImport` fields

#### Scenario: Vite plugin CSS import
- **WHEN** the Vite plugin constructs the manifest
- **THEN** `config.cssImport` SHALL be `'virtual:animus/styles.css'`

#### Scenario: Rust emitter reads config
- **WHEN** `transform_file()` processes a file
- **THEN** the emitter SHALL read `config.runtimeImport` and `config.cssImport` from the manifest to construct import statements, instead of using hardcoded strings
