## ADDED Requirements

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
