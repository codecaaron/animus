## MODIFIED Requirements

### Requirement: Pipeline utility exports
Extract SHALL export pipeline utility functions from `@animus-ui/extract/pipeline` that any bundler host can compose to complete the extraction pipeline. These are the shared bridge between the Rust NAPI core and framework-specific plugin code.

#### Scenario: Utilities importable from pipeline subpath
- **WHEN** a bundler plugin imports from `@animus-ui/extract/pipeline`
- **THEN** it SHALL have access to `applyUnitFallback`, `applyPrefix`, `resolveGlobalStyles`, `resolveTokenAliases`, `resolveValue`, `assembleStylesheet`, `validateLayerOrder`, `extractSystemFilePackages`, and `camelToKebab`
- **AND** it SHALL NOT export `execSubprocess` or `detectRuntime` (dead code removed)

#### Scenario: No orchestrator wrapper
- **WHEN** a bundler plugin needs to run the extraction pipeline
- **THEN** it SHALL call `analyzeProject()` from `@animus-ui/extract` directly for NAPI analysis, then compose pipeline utilities for post-processing. There is no single `runExtraction()` wrapper — each host owns its own lifecycle.

#### Scenario: Manifest includes pipeline timing
- **WHEN** `analyzeProject()` completes and returns its JSON manifest
- **THEN** the manifest SHALL include a `timing` object containing per-phase durations and metadata (file count, cache hits, total duration)

## ADDED Requirements

### Requirement: Manifest includes per-component CSS fragments
The `analyzeProject()` manifest SHALL include a `component_fragments` field containing per-component CSS for the 4 splittable layers (base, variants, compounds, states). The `css` and `sheets` fields SHALL continue to be present and unchanged.

#### Scenario: Fragments alongside existing fields
- **WHEN** `analyzeProject()` returns the manifest JSON
- **THEN** the manifest SHALL contain `css` (full concatenated), `sheets` (per-layer), AND `component_fragments` (per-component per-layer)

### Requirement: Manifest includes reverse provenance
The `analyzeProject()` manifest SHALL include a `reverse_provenance` field mapping parent component_ids to their direct children for transitive cache invalidation.

#### Scenario: Reverse provenance present
- **WHEN** `analyzeProject()` returns the manifest JSON and extension chains exist
- **THEN** the manifest SHALL contain `reverse_provenance` mapping parent component_ids to arrays of child component_ids

## REMOVED Requirements

### Requirement: Subprocess execution utilities
**Reason**: All subprocess operations (system loading, transform evaluation, global styles resolution) now use NAPI functions. `execSubprocess` and `detectRuntime` have zero consumers.
**Migration**: Use `loadSystemModule()` for system loading. Transforms resolved by boa_engine in Rust. Global styles resolved by Rust in `analyzeProject()`.
