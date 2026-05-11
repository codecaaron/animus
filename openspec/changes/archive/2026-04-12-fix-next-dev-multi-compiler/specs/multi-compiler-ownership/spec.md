## ADDED Requirements

### Requirement: In-memory CSS delivery via processAssets
The AnimusWebpackPlugin SHALL deliver CSS to webpack's asset pipeline via the `compilation.hooks.processAssets` hook, replacing the content of the `.animus/styles.css` asset with the assembled CSS from a shared module-scope variable. This replaces direct `writeFileSync` as the primary CSS delivery mechanism.

#### Scenario: processAssets replaces stub content
- **WHEN** webpack processes assets during a compilation
- **THEN** the plugin's `processAssets` hook SHALL find the `.animus/styles.css` asset in the compilation
- **AND** replace its content with the full assembled CSS from the shared variable
- **AND** this SHALL happen identically for every compiler instance (server, client, edge-server)

#### Scenario: Shared CSS is empty on first compilation
- **WHEN** `processAssets` fires before the extraction pipeline has completed (shared CSS is empty)
- **THEN** the hook SHALL skip asset replacement and leave the stub content intact

#### Scenario: Multiple compilers inject same CSS
- **WHEN** all 3 compiler instances' `processAssets` hooks fire during the same compilation cycle
- **THEN** each SHALL inject the same CSS content from the shared variable
- **AND** no coordination or ownership gating SHALL be required for correctness

### Requirement: Module-scope shared CSS storage
The singleton module SHALL provide a shared CSS variable accessible to all compiler instances via `globalThis`. The extraction pipeline stores assembled CSS here; `processAssets` reads from here.

#### Scenario: Pipeline stores CSS in shared variable
- **WHEN** `runFullPipeline()` or `runIncrementalPipeline()` completes CSS assembly
- **THEN** the assembled CSS SHALL be stored in the shared variable via the singleton setter

#### Scenario: Shared variable persists across compilations
- **WHEN** a new compilation starts (watch cycle N+1)
- **THEN** the shared CSS from the previous cycle SHALL still be available until updated by a new pipeline run

### Requirement: Stub file for module resolution
The `.animus/styles.css` file on disk SHALL serve as a resolution stub. It SHALL be created during the `webpack()` callback (before compilation starts) if it does not already exist. Its on-disk content is not authoritative — `processAssets` replaces it in-memory.

#### Scenario: Stub created on first build
- **WHEN** the `webpack()` callback runs and `.animus/styles.css` does not exist
- **THEN** a stub file SHALL be created containing only the `@layer` declaration
- **AND** this file SHALL be resolvable by webpack's module resolution

#### Scenario: Stub already exists
- **WHEN** the `webpack()` callback runs and `.animus/styles.css` already exists (from a previous build)
- **THEN** the existing file SHALL be left intact — `processAssets` will replace its content in-memory

### Requirement: Edge compiler early exit
The plugin SHALL skip all hook registration for the `edge-server` webpack compiler.

#### Scenario: Edge compiler detected
- **WHEN** `apply()` is called with a compiler whose `options.name` is `'edge-server'`
- **THEN** the plugin SHALL NOT register `run`, `watchRun`, or `processAssets` hooks

### Requirement: HMR trigger via disk write
After the extraction pipeline updates the shared CSS variable, the owning instance SHALL write the CSS to disk to trigger webpack's file watcher for HMR recompilation. The disk content does not need to be authoritative — `processAssets` ensures correct content regardless.

#### Scenario: CSS changes trigger recompilation
- **WHEN** the extraction pipeline produces new CSS (different content hash)
- **THEN** the plugin SHALL write the new CSS to `.animus/styles.css` on disk
- **AND** webpack's file watcher SHALL detect the change and trigger a new compilation
- **AND** the new compilation's `processAssets` SHALL inject the correct CSS from the shared variable
