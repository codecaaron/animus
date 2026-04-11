## REMOVED Requirements

### Requirement: Transform placeholder resolution function
**Reason**: Transform placeholders (`__TRANSFORM__`) were eliminated in the embedded-transform-eval change. Transforms are now evaluated in-process via boa_engine during CSS generation. The `resolveTransformPlaceholders()` function is no longer needed.
**Migration**: No migration needed. The function was only called from vite-plugin and next-plugin, both of which were updated to use the fully-resolved CSS from Rust directly.

## MODIFIED Requirements

### Requirement: Pipeline utility exports
Extract SHALL export pipeline utility functions from `@animus-ui/extract/pipeline` that any bundler host can compose to complete the extraction pipeline. These are the shared bridge between the Rust NAPI core and framework-specific plugin code.

#### Scenario: Utilities importable from pipeline subpath
- **WHEN** a bundler plugin imports from `@animus-ui/extract/pipeline`
- **THEN** it SHALL have access to `applyUnitFallback`, `applyPrefix`, `resolveGlobalStyles`, `resolveTokenAliases`, `resolveValue`, and `camelToKebab`

#### Scenario: No orchestrator wrapper
- **WHEN** a bundler plugin needs to run the extraction pipeline
- **THEN** it SHALL call `analyzeProject()` from `@animus-ui/extract` directly for NAPI analysis, then compose pipeline utilities for post-processing. There is no single `runExtraction()` wrapper — each host owns its own lifecycle.
