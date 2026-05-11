## MODIFIED Requirements

### Requirement: Pipeline utility exports
Extract SHALL export pipeline utility functions from `@animus-ui/extract/pipeline` that any bundler host can compose to complete the extraction pipeline. These are the shared bridge between the Rust NAPI core and framework-specific plugin code.

#### Scenario: Utilities importable from pipeline subpath
- **WHEN** a bundler plugin imports from `@animus-ui/extract/pipeline`
- **THEN** it SHALL have access to `applyUnitFallback`, `applyPrefix`, `resolveGlobalStyles`, `resolveTokenAliases`, `resolveValue`, and `camelToKebab`

#### Scenario: No orchestrator wrapper
- **WHEN** a bundler plugin needs to run the extraction pipeline
- **THEN** it SHALL call `analyzeProject()` from `@animus-ui/extract` directly for NAPI analysis, then compose pipeline utilities for post-processing. There is no single `runExtraction()` wrapper — each host owns its own lifecycle.

#### Scenario: Manifest includes pipeline timing
- **WHEN** `analyzeProject()` completes and returns its JSON manifest
- **THEN** the manifest SHALL include a `timing` object containing per-phase durations and metadata (file count, cache hits, total duration)

#### Scenario: System module loading via NAPI
- **WHEN** a bundler plugin needs to load a system module (ds.ts) to obtain extraction config
- **THEN** it SHALL call `loadSystemModule(systemPath, rootDir)` from `@animus-ui/extract` which returns a `SystemConfig` object with all required config fields — no subprocess needed
