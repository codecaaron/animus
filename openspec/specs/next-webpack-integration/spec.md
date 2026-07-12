## Purpose

Requirements for the `next-webpack-integration` capability: Webpack plugin orchestrates extraction pipeline; Webpack loader transforms source files; Runtime-agnostic subprocess execution; and 2 more.

## Requirements

### Requirement: Webpack plugin orchestrates extraction pipeline

The Next.js webpack plugin SHALL run the full extraction pipeline (loadSystem → analyzeProject → applyUnitFallback) once per build, sharing results across all webpack compiler instances via a module-scope singleton promise mutex. The plugin SHALL pass all config fields from `loadSystemModule()` to `analyzeProject()`, including `selectorAliasesJson` and `selectorOrderJson`. CSS delivery SHALL use the `processAssets` hook to inject assembled CSS into webpack's asset pipeline, rather than writing directly to disk.

#### Scenario: Single analysis across multi-compiler

- **WHEN** Next.js invokes the webpack config function three times (server-nodejs, server-edge, client)
- **THEN** `analyzeProject()` SHALL execute exactly once
- **AND** the assembled CSS SHALL be stored in a shared module-scope variable
- **AND** all three compiler instances' `processAssets` hooks SHALL inject the same CSS into their respective asset pipelines

#### Scenario: Plugin delivers CSS via processAssets

- **WHEN** analysis completes and CSS is assembled
- **THEN** the plugin SHALL store the CSS in the shared variable
- **AND** `processAssets` SHALL replace the `.animus/styles.css` asset content in each compiler's compilation
- **AND** disk writes SHALL serve only as HMR triggers, not as the authoritative CSS source

#### Scenario: Selector aliases passed to analysis

- **WHEN** `loadSystemModule()` returns `selectorAliases` and `selectorOrder`
- **THEN** the plugin SHALL capture these values and pass them to `analyzeProject()` as `selectorAliasesJson` and `selectorOrderJson` (not null)

### Requirement: Webpack loader transforms source files

The webpack loader SHALL call `transformFile()` for each `.ts`/`.tsx`/`.js`/`.jsx` file, using the cached manifest from the plugin's analysis pass. Files with no extractable components SHALL pass through unchanged.

#### Scenario: File with extractable components

- **WHEN** the loader processes a source file that contains builder chain components listed in the manifest
- **THEN** it SHALL return the transformed source with builder chains replaced by `createComponent()` calls and a CSS import injected

#### Scenario: File with no components

- **WHEN** the loader processes a source file that has no components in the manifest
- **THEN** it SHALL return the original source unchanged without calling `transformFile()`

#### Scenario: Loader runs before other transforms

- **WHEN** webpack processes source files through the loader chain
- **THEN** the Animus loader SHALL execute with `enforce: 'pre'` to see original source before Babel/SWC transformation

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

### Requirement: Verbose timing display in next-plugin

When verbose mode is enabled, the next-plugin SHALL display hierarchical per-phase timing after extraction completes, using the same waterfall format as the vite-plugin. The zero-cost timer gate SHALL ensure no overhead when verbose is off.

#### Scenario: Verbose build shows hierarchical breakdown

- **WHEN** `verbose: true` is configured and a build triggers extraction
- **THEN** the plugin SHALL log the hierarchical waterfall showing JS phases with nested Rust PipelineTiming phases, matching the vite-plugin format

#### Scenario: Non-verbose mode unchanged

- **WHEN** `verbose` is false or not configured
- **THEN** no timing waterfall SHALL be displayed and no `performance.now()` calls SHALL occur

### Requirement: Incremental HMR with cache-hit optimization

The next-plugin `handleWatchUpdate` SHALL use a file cache with content hashing to avoid re-reading unchanged files. On watch update, only changed files SHALL send full source across the NAPI boundary — cache-hit files SHALL send empty source.

#### Scenario: Unchanged files not re-serialized

- **WHEN** a single file changes during dev watch
- **THEN** only the changed file's source SHALL be included in the NAPI file entries
- **AND** all other files SHALL send empty source strings with their cached content hash

#### Scenario: Cache populated at first build

- **WHEN** `runFullPipeline()` completes
- **THEN** all discovered files SHALL be stored in the file cache with their content hash and source
