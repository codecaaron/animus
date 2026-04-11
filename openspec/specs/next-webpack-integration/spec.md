### Requirement: Webpack plugin orchestrates extraction pipeline
The Next.js webpack plugin SHALL run the full extraction pipeline (loadSystem → analyzeProject → resolveTransformPlaceholders → applyUnitFallback) once per build, sharing results across all webpack compiler instances via a module-level promise mutex.

#### Scenario: Single analysis across multi-compiler
- **WHEN** Next.js invokes the webpack config function three times (server-nodejs, server-edge, client)
- **THEN** `analyzeProject()` SHALL execute exactly once, and all three compiler instances SHALL receive the same manifest and CSS

#### Scenario: Plugin writes CSS to disk
- **WHEN** analysis completes and CSS is resolved
- **THEN** the plugin SHALL write the combined CSS (variable declarations + global styles + component CSS) to `.animus/styles.css` in the project root
- **AND** the file SHALL only be written if its content hash differs from the existing file

#### Scenario: Plugin runs at correct lifecycle hook
- **WHEN** webpack compilation begins
- **THEN** the plugin SHALL tap `compiler.hooks.run` (production) and `compiler.hooks.watchRun` (dev) to trigger analysis before module resolution starts

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
The subprocess model SHALL be replaced by direct NAPI calls for system loading. The `loadSystemModule()` NAPI function handles system module loading internally via OXC + rquickjs — no subprocess or external runtime detection needed for this path. Subprocess execution MAY be retained for other purposes if needed.

#### Scenario: System loading via NAPI
- **WHEN** the next-plugin needs to load the system module during `runFullPipeline()`
- **THEN** it SHALL call `loadSystemModule(systemPath, rootDir)` from `@animus-ui/extract` and use the returned `SystemConfig` fields directly

#### Scenario: No runtime detection for system loading
- **WHEN** `loadSystemModule()` is used for system loading
- **THEN** no `bun` or `node` runtime detection SHALL be required — execution happens in-process via the NAPI binary

### Requirement: Verbose timing display in next-plugin
When verbose mode is enabled, the next-plugin SHALL display hierarchical per-phase timing after extraction completes, using the same waterfall format as the vite-plugin. The zero-cost timer gate SHALL ensure no overhead when verbose is off.

#### Scenario: Verbose build shows hierarchical breakdown
- **WHEN** `verbose: true` is configured and a build triggers extraction
- **THEN** the plugin SHALL log the hierarchical waterfall showing JS phases with nested Rust PipelineTiming phases, matching the vite-plugin format

#### Scenario: Non-verbose mode unchanged
- **WHEN** `verbose` is false or not configured
- **THEN** no timing waterfall SHALL be displayed and no `performance.now()` calls SHALL occur
