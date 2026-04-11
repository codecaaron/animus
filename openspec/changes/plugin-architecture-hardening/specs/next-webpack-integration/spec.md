## MODIFIED Requirements

### Requirement: Webpack plugin orchestrates extraction pipeline
The Next.js webpack plugin SHALL run the full extraction pipeline (loadSystem → analyzeProject → applyUnitFallback) once per build, sharing results across all webpack compiler instances via a module-level promise mutex. The plugin SHALL pass all config fields from `loadSystemModule()` to `analyzeProject()`, including `selectorAliasesJson` and `selectorOrderJson`.

#### Scenario: Single analysis across multi-compiler
- **WHEN** Next.js invokes the webpack config function three times (server-nodejs, server-edge, client)
- **THEN** `analyzeProject()` SHALL execute exactly once, and all three compiler instances SHALL receive the same manifest and CSS

#### Scenario: Plugin writes CSS to disk
- **WHEN** analysis completes and CSS is resolved
- **THEN** the plugin SHALL write the combined CSS (variable declarations + global styles + component CSS) to `.animus/styles.css` in the project root
- **AND** the file SHALL only be written if its content hash differs from the existing file

#### Scenario: Selector aliases passed to analysis
- **WHEN** `loadSystemModule()` returns `selectorAliases` and `selectorOrder`
- **THEN** the plugin SHALL capture these values and pass them to `analyzeProject()` as `selectorAliasesJson` and `selectorOrderJson` (not null)

### Requirement: Runtime-agnostic subprocess execution
The subprocess model SHALL be replaced by direct NAPI calls for system loading. The `loadSystemModule()` NAPI function handles system module loading internally via OXC + rquickjs — no subprocess or external runtime detection needed for this path. No subprocess-related references SHALL remain in source comments.

#### Scenario: System loading via NAPI
- **WHEN** the next-plugin needs to load the system module during `runFullPipeline()`
- **THEN** it SHALL call `loadSystemModule(systemPath, rootDir)` from `@animus-ui/extract` and use the returned `SystemConfig` fields directly

#### Scenario: No runtime detection for system loading
- **WHEN** `loadSystemModule()` is used for system loading
- **THEN** no `bun` or `node` runtime detection SHALL be required — execution happens in-process via the NAPI binary

#### Scenario: No subprocess references in comments
- **WHEN** next-plugin source is searched for "subprocess"
- **THEN** zero matches SHALL be found in source comments (JSDoc and inline)

## ADDED Requirements

### Requirement: Incremental HMR with cache-hit optimization
The next-plugin `handleWatchUpdate` SHALL use a file cache with content hashing to avoid re-reading unchanged files. On watch update, only changed files SHALL send full source across the NAPI boundary — cache-hit files SHALL send empty source.

#### Scenario: Unchanged files not re-serialized
- **WHEN** a single file changes during dev watch
- **THEN** only the changed file's source SHALL be included in the NAPI file entries
- **AND** all other files SHALL send empty source strings with their cached content hash

#### Scenario: Cache populated at first build
- **WHEN** `runFullPipeline()` completes
- **THEN** all discovered files SHALL be stored in the file cache with their content hash and source
