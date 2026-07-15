## Purpose

Requirements for the `next-dev-hmr` capability: Incremental re-analysis on file change; System-props update during incremental re-analysis; Geological reset on system file change; and 1 more.

## Requirements

### Requirement: Incremental re-analysis on file change

In dev mode, the extraction pipeline SHALL run via the existing singleton deduplication (one instance executes, others await). After CSS is assembled, it SHALL be stored in the shared variable. After system-props content is reconstructed, it SHALL be stored in the shared variable via `setSharedSystemProps()`. Disk writes after CSS or system-props changes SHALL serve as HMR triggers. `processAssets` SHALL ensure all compilers deliver correct CSS regardless of which instance ran the pipeline.

#### Scenario: Component file changed

- **WHEN** a source file containing builder chain components is modified during dev
- **THEN** the owning instance SHALL re-run `analyzeProject()` with updated file entries
- **AND** store the new CSS in the shared variable
- **AND** extract `system_prop_map` and `dynamic_props` from the manifest
- **AND** reconstruct and store the system-props content in the shared variable
- **AND** write CSS to disk (if changed) to trigger webpack recompilation
- **AND** write system-props.js to disk (if changed) to trigger JS HMR
- **AND** the recompilation's `processAssets` SHALL inject the updated CSS

#### Scenario: Non-component file changed

- **WHEN** a source file with no extractable components is modified during dev
- **THEN** the plugin SHALL skip re-analysis (content hash check shows no manifest-relevant change)

#### Scenario: CSS content unchanged after re-analysis

- **WHEN** re-analysis produces identical CSS (same content hash)
- **THEN** no disk write SHALL occur and no recompilation SHALL be triggered

### Requirement: System-props update during incremental re-analysis

In dev mode, when `runIncrementalPipeline()` completes re-analysis, the plugin SHALL extract `system_prop_map` and `dynamic_props` from the manifest and reconstruct the `system-props.js` module content. The updated content SHALL be stored in the shared variable via `setSharedSystemProps()` and written to disk with a content-hash guard.

#### Scenario: New system prop usage triggers system-props update

- **WHEN** a developer adds `<Box px={16} />` where `px` was not previously used in any JSX
- **THEN** `runIncrementalPipeline()` SHALL extract the updated `system_prop_map` containing the new `px` entry
- **AND** write the updated `system-props.js` to disk
- **AND** store the content in the shared variable via `setSharedSystemProps()`
- **AND** webpack's file watcher SHALL detect the change and trigger JS module HMR

#### Scenario: System-props content unchanged after re-analysis

- **WHEN** a developer edits a component but does not introduce any new system prop usages or values
- **THEN** the plugin SHALL NOT rewrite `system-props.js` to disk (content hash matches previous write)
- **AND** no JS module invalidation SHALL occur for system-props

#### Scenario: Dynamic props updated during incremental

- **WHEN** a component adds a new `.props()` custom dynamic prop during dev
- **THEN** `runIncrementalPipeline()` SHALL extract the updated `dynamic_props` from the manifest
- **AND** include the new `dynamicPropConfig` entry in the reconstructed `system-props.js`

### Requirement: Geological reset on system file change

The plugin SHALL detect changes to the system file and trigger a full reload — cache clear, system reload, and complete re-analysis. The new CSS SHALL be stored in the shared variable and written to disk for HMR.

#### Scenario: System file modified

- **WHEN** the system file (e.g., `src/ds.ts`) is modified during dev
- **THEN** the plugin SHALL call `clearAnalysisCache()`, re-run `loadSystem()`, re-run `analyzeProject()` with fresh config, store new CSS in the shared variable, and write to disk

#### Scenario: Theme token change

- **WHEN** the theme tokens or color scales change
- **THEN** the geological reset SHALL produce updated variable CSS, stored in the shared variable and written to disk for HMR

### Requirement: Content hash deduplication

The plugin SHALL track content hashes for source files to avoid redundant analysis and CSS writes.

#### Scenario: Unchanged file skipped

- **WHEN** a file's content hash matches the previous analysis pass
- **THEN** the plugin SHALL send an empty source with the hash to `analyzeProject()` (Rust cache-hit path skips re-parse)

#### Scenario: CSS write skipped when unchanged

- **WHEN** resolved CSS content is identical to the existing `.animus/styles.css`
- **THEN** the plugin SHALL NOT rewrite the file (avoids unnecessary webpack recompilation)
