## MODIFIED Requirements

### Requirement: NAPI function signature
The Rust crate SHALL export THREE NAPI functions:
1. `extract(source, filename, theme_json, variable_map_json, config_json, group_registry_json) -> ExtractionResult` — per-file extraction (preserved for backward compatibility and testing)
2. `analyze_project(file_entries_json, theme_json, variable_map_json, contextual_vars_json?, config_json, group_registry_json, package_resolution_json, dev_mode?, prefix?, emitter_config_json?) -> String` — project-level analysis returning JSON manifest. The new `emitter_config_json` parameter accepts an optional JSON string specifying `EmitterConfig` for configurable runtime import and CSS module ID.
3. `transform_file(source, filename, manifest_json) -> TransformResult` — per-file transformation using manifest. When the manifest contains emitter config, `apply_replacements` SHALL use those paths instead of hardcoded defaults.

The `theme_json` parameter SHALL include `breakpoints.*` keys in the flattened theme. The extraction pipeline SHALL derive breakpoint key names from these entries rather than using any hardcoded constant.

#### Scenario: Backward-compatible extract
- **WHEN** `extract()` is called with a file containing only primary chains (no extensions)
- **THEN** it SHALL produce the same result as before — CSS, transformed code, extractable flag, errors

#### Scenario: analyze_project with emitter config
- **WHEN** `analyze_project()` is called with `emitter_config_json: '{"runtime_import":"@animus-ui/system","css_module_id":".animus/styles.css"}'`
- **THEN** the returned manifest SHALL include the emitter config and `transform_file()` SHALL use those paths in generated import statements

#### Scenario: analyze_project without emitter config
- **WHEN** `analyze_project()` is called with `emitter_config_json: None`
- **THEN** the manifest SHALL use default emitter paths (`@animus-ui/system`, `virtual:animus/styles.css`) — backward compatible with existing Vite plugin behavior

#### Scenario: transform_file reads emitter config from manifest
- **WHEN** `transform_file()` is called with a manifest containing emitter config
- **THEN** it SHALL emit `import { createComponent } from '<runtime_import>'` and `import '<css_module_id>'` using the config values

#### Scenario: Custom breakpoints in theme_json
- **WHEN** `theme_json` contains `{ "breakpoints.mobile": "480", "breakpoints.tablet": "768", "breakpoints.desktop": "1024" }`
- **THEN** the extraction pipeline SHALL recognize `{ mobile: value, tablet: value, desktop: value }` as responsive objects and generate `@media (min-width: 480px)`, `@media (min-width: 768px)`, `@media (min-width: 1024px)` queries

#### Scenario: analyze_project with extensions
- **WHEN** `analyze_project()` is called with files containing extension chains
- **THEN** the returned manifest JSON SHALL contain all components (primary and extended), resolved provenance, merged chain configs, and complete CSS

#### Scenario: transform_file uses manifest
- **WHEN** `transform_file()` is called with a file and a manifest
- **THEN** it SHALL look up the file's components in the manifest and apply source replacements using the manifest's precomputed class names and configs
