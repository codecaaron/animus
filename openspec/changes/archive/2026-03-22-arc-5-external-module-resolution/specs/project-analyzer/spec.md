## MODIFIED Requirements

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
