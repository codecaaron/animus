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

### Requirement: FileEntry accepts optional content hash

The `FileEntry` input structure SHALL accept an optional `hash` field (string or null). When present, the hash is used for cache lookup. When absent, the file is always re-parsed.

#### Scenario: Hash field present
- **WHEN** a FileEntry includes `{ path: "src/Button.tsx", source: "...", hash: "abc123" }`
- **THEN** the analyzer checks the per-file cache for path "src/Button.tsx" with hash "abc123"

#### Scenario: Hash field absent
- **WHEN** a FileEntry includes `{ path: "src/Button.tsx", source: "..." }` with no hash field
- **THEN** the file is re-parsed unconditionally (backward-compatible behavior)

---

### Requirement: analyzeProject accepts dev_mode parameter

The `analyzeProject()` NAPI function SHALL accept an optional `dev_mode` boolean parameter. When `true`, JSX scanning runs ONLY on changed files (cache misses), cached scan results are reused for unchanged files, and reconciliation is skipped entirely. When `false` or absent, full analysis proceeds unchanged (all files scanned, reconciliation applied).

#### Scenario: Dev-mode parameter passed
- **WHEN** `analyzeProject()` is called with `dev_mode: true`
- **THEN** JSX scanning runs only on changed files (cache misses), cached scan results are merged for unchanged files, and reconciliation is skipped

#### Scenario: Dev-mode parameter absent
- **WHEN** `analyzeProject()` is called without a `dev_mode` parameter
- **THEN** the analysis runs all phases including full JSX scanning (all files) and reconciliation (unchanged from current behavior)

---

### Requirement: Manifest output identical for cached vs uncached analysis

Given identical file inputs, `analyzeProject()` SHALL produce the same manifest regardless of whether per-file extraction results were served from cache or freshly parsed. The cache SHALL NOT introduce divergence in component ordering, CSS output, or extension merging.

#### Scenario: Cached result matches full analysis
- **WHEN** `analyzeProject()` is called twice with the same file inputs — first without cache, second with cache populated from the first call
- **THEN** the manifest JSON output of both calls is byte-identical
