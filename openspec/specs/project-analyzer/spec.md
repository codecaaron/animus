## ADDED Requirements

### Requirement: Project-level analysis NAPI entry point
The Rust crate SHALL export `analyze_project(file_entries_json, theme_json, config_json, group_registry_json, package_resolution_json) -> String` that performs full-codebase static analysis including package-name import resolution and returns a JSON UniverseManifest. The `package_resolution_json` parameter is a JSON map of package specifiers to resolved entry file paths.

#### Scenario: Analysis with package resolution
- **WHEN** `analyze_project` is called with a package resolution map `{ "@animus-ui/components": "packages/ui/src/index.ts" }` and files include both the project source and the resolved package source
- **THEN** components imported via `@animus-ui/components` SHALL be resolved to their definition files, enabling correct provenance tracking, JSX usage detection, and reconciliation

#### Scenario: Analysis without package resolution (backward compatible)
- **WHEN** `analyze_project` is called with an empty package resolution map `{}`
- **THEN** behavior SHALL be identical to the current implementation — package-name imports are treated as external and bindings through them are unresolvable

#### Scenario: Package resolution map passed to import resolver
- **WHEN** the project analyzer builds the import resolver's path resolution callback
- **THEN** the callback SHALL check the package resolution map for non-relative import sources before returning None

### Requirement: Per-file transform from manifest
The Rust crate SHALL export a NAPI function `transform_file(source: String, filename: String, manifest_json: String) -> TransformResult` where `TransformResult` contains `code: String` and `has_components: bool`. The function SHALL look up the file's components in the manifest and apply source replacements.

#### Scenario: Transform file with components
- **WHEN** `transform_file` is called for a file that has components in the manifest
- **THEN** the result SHALL have `has_components: true` and `code` containing `createComponent()` calls with the class names and configs from the manifest

#### Scenario: Transform file without components
- **WHEN** `transform_file` is called for a file that has no components in the manifest
- **THEN** the result SHALL have `has_components: false` and `code` identical to the input source

#### Scenario: Transform file adds CSS import
- **WHEN** `transform_file` is called for a file that has components
- **THEN** the transformed code SHALL include an import for the global CSS virtual module (e.g., `import 'virtual:animus/styles.css'`)

### Requirement: UniverseManifest structure
The manifest JSON SHALL contain: `components`, `utilities`, `css` (reconciled), `provenance`, `files`, `usage` (usage ledger data), and `report` (extraction report). The `css` field SHALL contain ONLY CSS for used variants, used states, and rendered components — dead rules SHALL be eliminated before CSS generation.

#### Scenario: Manifest with reconciled CSS
- **WHEN** the project has components with unused variant options and states
- **THEN** `manifest.css` SHALL NOT contain CSS rules for unused variant options or states

#### Scenario: Manifest with usage field
- **WHEN** the analysis completes
- **THEN** `manifest.usage` SHALL contain `{ rendered_components: [...], variant_usage: {...}, state_usage: {...} }`

#### Scenario: Manifest with report field
- **WHEN** the analysis completes
- **THEN** `manifest.report` SHALL contain flat fields: `components_total`, `components_extracted`, `components_eliminated`, `variants_total`, `variants_used`, `variants_eliminated`, `states_total`, `states_used`, `states_eliminated`, and `eliminated_details` array
