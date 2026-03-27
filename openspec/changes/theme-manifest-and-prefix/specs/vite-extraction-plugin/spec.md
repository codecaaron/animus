## MODIFIED Requirements

### Requirement: Plugin factory function
The plugin factory SHALL accept a `system` option pointing to the module that exports the SystemInstance. Additionally, it SHALL accept optional `targets` (browserslist query string or array), `minify` (boolean), `prefix` (string), and `layers` (string array) options.

#### Scenario: System instance path
- **WHEN** consumer configures `animusExtract({ system: './src/ds.ts' })`
- **THEN** the plugin SHALL load that module via a single bun subprocess to obtain tokens, prop config, group registry, and transforms

#### Scenario: Full configuration with prefix and layers
- **WHEN** consumer configures `animusExtract({ system: './src/ds.ts', prefix: 'mylib', layers: ['reset', 'mylib-global', 'mylib-base', 'mylib-variants', 'mylib-states', 'mylib-system', 'mylib-custom', 'overrides'] })`
- **THEN** the plugin SHALL configure namespace prefixing for CSS variables, class names, and layer names, AND validate the layer order at init

#### Scenario: Default configuration unchanged
- **WHEN** consumer configures `animusExtract()` or `animusExtract({ system: './src/ds.ts' })` with no prefix or layers
- **THEN** the plugin SHALL use unprefixed variable names, `animus-` class name prefix, and the hardcoded `@layer global, base, variants, states, system, custom` declaration — identical to current behavior

## ADDED Requirements

### Requirement: Consolidated Rust FFI
The plugin SHALL pass theme data to the Rust crate as a single consolidated manifest JSON string instead of separate `scalesJson`, `variableMapJson` parameters. The manifest JSON SHALL include the token map, variable map, prefix, and layer names.

#### Scenario: Single manifest parameter to analyze_project
- **WHEN** the plugin calls `analyze_project()`
- **THEN** it SHALL pass a single `manifestJson` string containing `{ tokenMap, variableMap, prefix, layerNames }` alongside the existing `configJson` and `groupRegistryJson` parameters

#### Scenario: Prefix included in manifest
- **WHEN** plugin is configured with `prefix: 'mylib'`
- **THEN** the manifest JSON passed to Rust SHALL include `"prefix": "mylib"` and the variable map SHALL contain prefixed variable names (`--mylib-color-ember`)

### Requirement: Layer order validation at init
The plugin SHALL validate the `layers` configuration at the `configResolved` hook, before `buildStart`.

#### Scenario: Layer validation timing
- **WHEN** plugin is configured with an invalid `layers` array
- **THEN** the validation error SHALL be thrown at `configResolved`, not at `buildStart` or later

#### Scenario: Layer validation identifies the violation
- **WHEN** `layers` contains `['mylib-system', 'mylib-base']` (system before base)
- **THEN** the error message SHALL identify which layers are out of order: `'mylib-system' must come after 'mylib-base'`
