## MODIFIED Requirements

### Requirement: NAPI function signature
The Rust crate SHALL export THREE NAPI functions:
1. `extract(source, filename, theme_json, config_json, group_registry_json) -> ExtractionResult` — per-file extraction (preserved for backward compatibility and testing)
2. `analyze_project(file_entries_json, theme_json, config_json, group_registry_json) -> String` — project-level analysis returning JSON manifest
3. `transform_file(source, filename, manifest_json) -> TransformResult` — per-file transformation using manifest

The crate SHALL be compiled for three NAPI targets: `aarch64-apple-darwin`, `x86_64-unknown-linux-gnu`, `aarch64-unknown-linux-gnu`.

#### Scenario: Backward-compatible extract
- **WHEN** `extract()` is called with a file containing only primary chains (no extensions)
- **THEN** it SHALL produce the same result as Arc 2 — CSS, transformed code, extractable flag, errors

#### Scenario: analyze_project with extensions
- **WHEN** `analyze_project()` is called with files containing extension chains
- **THEN** the returned manifest JSON SHALL contain all components (primary and extended), resolved provenance, merged chain configs, and complete CSS

#### Scenario: transform_file uses manifest
- **WHEN** `transform_file()` is called with a file and a manifest
- **THEN** it SHALL look up the file's components in the manifest and apply source replacements using the manifest's precomputed class names and configs

#### Scenario: Chain with groups is extractable
- **WHEN** `extract()` is called with source containing `animus.styles({...}).groups({ space: true }).asElement('div')` and JSX elements using system props
- **THEN** the result SHALL have `extractable: true`, `css` containing both component layer CSS and utility CSS in `@layer system`, and `code` containing `createComponent()` with system prop class map

#### Scenario: Chain with props is extractable
- **WHEN** `extract()` is called with source containing `animus.styles({...}).props({ logoSize: {...} }).asElement('h1')` and JSX elements using custom props
- **THEN** the result SHALL have `extractable: true`, `css` containing utility CSS in `@layer custom`

#### Scenario: Binary loads on supported platforms
- **WHEN** the `@animus-ui/extract` package is installed on `darwin-arm64`, `linux-x64`, or `linux-arm64`
- **THEN** the binary loader SHALL find and load the platform-appropriate `.node` binary
