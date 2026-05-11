## ADDED Requirements

### Requirement: Project-level analysis NAPI entry point
The Rust crate SHALL export a NAPI function `analyze_project(file_entries_json: String, theme_json: String, config_json: String, group_registry_json: String) -> String` that performs full-codebase static analysis and returns a JSON UniverseManifest. `file_entries_json` is a JSON array of `{ path: string, source: string }` objects.

#### Scenario: Analyze project with no extensions
- **WHEN** `analyze_project` is called with files containing only `animus.` chains (no `.extend()`)
- **THEN** the manifest SHALL contain all component definitions, their CSS, utility classes from JSX scanning, and the complete `@layer`-structured CSS output

#### Scenario: Analyze project with extensions
- **WHEN** `analyze_project` is called with files where FileB imports Button from FileA and does `Button.extend().styles({...}).asElement('div')`
- **THEN** the manifest SHALL contain both Button and the extended component, with the extended component's `extendsFrom` field pointing to Button's component ID, and its CSS reflecting the merged chain

#### Scenario: Analyze project with no animus chains
- **WHEN** `analyze_project` is called with files containing no `animus.` chains and no extension chains
- **THEN** the manifest SHALL have empty `components`, empty `utilities`, and empty `css`

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
The manifest JSON SHALL contain: `components` (map of component ID to component descriptor), `utilities` (map of class name to CSS declaration), `css` (complete @layer-structured CSS string), `provenance` (map of component ID to array of ancestor component IDs), and `files` (map of file path to array of component IDs defined in that file).

#### Scenario: Component ID format
- **WHEN** a component `Box` is defined in `src/elements/Box.tsx`
- **THEN** its component ID SHALL be `src/elements/Box.tsx::Box`

#### Scenario: Manifest contains complete CSS
- **WHEN** the project has components with styles, variants, states, groups, and extensions
- **THEN** `manifest.css` SHALL contain the complete CSS with `@layer base, variants, states, system, custom;` declaration and all component and utility rules in their correct layers

#### Scenario: Manifest lists files to components
- **WHEN** `src/Button.tsx` defines `ButtonContainer` and `ButtonForeground`
- **THEN** `manifest.files["src/Button.tsx"]` SHALL be `["src/Button.tsx::ButtonContainer", "src/Button.tsx::ButtonForeground"]`
