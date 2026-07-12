## Purpose

Requirements for the `extraction-emitter-config` capability: Configurable emitter paths; EmitterConfig struct; system_props_module_id emitter config field; and 1 more.

## Requirements

### Requirement: Configurable emitter paths

The Rust `transform_emitter.rs` SHALL accept an `EmitterConfig` struct specifying the runtime import source and CSS module ID. When no config is provided, the emitter SHALL use default values (`@animus-ui/system` and `virtual:animus/styles.css`).

#### Scenario: Default emitter config

- **WHEN** `analyze_project()` is called without emitter config (or with null)
- **THEN** `transform_file()` SHALL emit `import { createComponent } from '@animus-ui/system'` and `import 'virtual:animus/styles.css'`

#### Scenario: Custom emitter config for Next.js

- **WHEN** `analyze_project()` is called with `emitter_config_json: '{"runtime_import":"@animus-ui/system","css_module_id":".animus/styles.css"}'`
- **THEN** `transform_file()` SHALL emit `import { createComponent } from '@animus-ui/system'` and `import '.animus/styles.css'`

#### Scenario: Emitter config persists in manifest

- **WHEN** `analyze_project()` receives an emitter config
- **THEN** the returned manifest JSON SHALL include the emitter config so that `transform_file()` can read it without additional parameters

### Requirement: EmitterConfig struct

The `EmitterConfig` struct SHALL have two fields: `runtime_import` (String) and `css_module_id` (String). It SHALL be deserializable from JSON via serde.

#### Scenario: Struct deserialization

- **WHEN** the JSON `{"runtime_import":"@animus-ui/system","css_module_id":".animus/styles.css"}` is deserialized
- **THEN** the resulting `EmitterConfig` SHALL have `runtime_import = "@animus-ui/system"` and `css_module_id = ".animus/styles.css"`

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
