## MODIFIED Requirements

### Requirement: Configurable emitter paths
The Rust `transform_emitter.rs` SHALL accept an `EmitterConfig` struct specifying the runtime import source and CSS module ID. When no config is provided, the emitter SHALL use default values (`@animus-ui/system` and `virtual:animus/styles.css`). The `analyze_project()` function SHALL additionally accept an optional `prefix` parameter that is threaded to all CSS generation functions for layer, variable, and class name prefixing.

#### Scenario: Default emitter config
- **WHEN** `analyze_project()` is called without emitter config (or with null)
- **THEN** `transform_file()` SHALL emit `import { createComponent } from '@animus-ui/system'` and `import 'virtual:animus/styles.css'`

#### Scenario: Custom emitter config for Next.js
- **WHEN** `analyze_project()` is called with `emitter_config_json: '{"runtime_import":"@animus-ui/system","css_module_id":".animus/styles.css"}'`
- **THEN** `transform_file()` SHALL emit `import { createComponent } from '@animus-ui/system'` and `import '.animus/styles.css'`

#### Scenario: Emitter config persists in manifest
- **WHEN** `analyze_project()` receives an emitter config
- **THEN** the returned manifest JSON SHALL include the emitter config so that `transform_file()` can read it without additional parameters

#### Scenario: Prefix parameter threads to CSS generation
- **WHEN** `analyze_project()` is called with `prefix: Some("acme")`
- **THEN** all CSS generation functions (`generate_css`, `generate_sheets_from_slice`, `generate_utility_css_impl`) SHALL receive the prefix and apply it to `@layer` names, CSS variable names, and class name prefixes

#### Scenario: No prefix parameter (default)
- **WHEN** `analyze_project()` is called without a prefix (or with `None`)
- **THEN** CSS generation SHALL use default unprefixed layer names and the `animus` class prefix

### Requirement: EmitterConfig struct
The `EmitterConfig` struct SHALL have two fields: `runtime_import` (String) and `css_module_id` (String). It SHALL be deserializable from JSON via serde.

#### Scenario: Struct deserialization
- **WHEN** the JSON `{"runtime_import":"@animus-ui/system","css_module_id":".animus/styles.css"}` is deserialized
- **THEN** the resulting `EmitterConfig` SHALL have `runtime_import = "@animus-ui/system"` and `css_module_id = ".animus/styles.css"`
