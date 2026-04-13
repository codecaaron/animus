## ADDED Requirements

### Requirement: system_props_module_id emitter config field
The `EmitterConfig` SHALL support an optional `system_props_module_id` field specifying the module path for the system props import. When provided, the Rust emitter SHALL use this path for `import { systemPropMap } from '<system_props_module_id>'` in transformed files.

#### Scenario: Next.js emitter config with system_props_module_id
- **WHEN** `analyzeProject()` is called with `emitter_config_json: '{"runtime_import":"@animus-ui/system/runtime","css_module_id":".animus/styles.css","system_props_module_id":"/abs/path/.animus/system-props.js"}'`
- **THEN** transformed files with system props SHALL import from the specified `system_props_module_id` path

#### Scenario: Vite emitter config without system_props_module_id
- **WHEN** `analyzeProject()` is called without `system_props_module_id` in the config
- **THEN** the emitter SHALL fall back to the default `virtual:animus/system-props` path

### Requirement: Emitter config consistency between pipeline paths
The webpack plugin SHALL use identical `emitterConfig` values in both `runFullPipeline()` and `runIncrementalPipeline()`. All three fields (`runtime_import`, `css_module_id`, `system_props_module_id`) SHALL match between the two paths.

#### Scenario: Incremental emitterConfig matches full
- **WHEN** `runIncrementalPipeline()` constructs its `emitterConfig`
- **THEN** `css_module_id` SHALL be `'.animus/styles.css'` (not a system-props path)
- **AND** `system_props_module_id` SHALL be the absolute path to `.animus/system-props.js`
- **AND** `runtime_import` SHALL be `'@animus-ui/system/runtime'`

#### Scenario: Replacement strings use correct imports after incremental
- **WHEN** a component is re-analyzed during incremental pipeline
- **THEN** its replacement string SHALL contain `import '.animus/styles.css'` for CSS (not a system-props path)
- **AND** its replacement string SHALL contain the correct system-props import path
