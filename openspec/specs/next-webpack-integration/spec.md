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
The subprocess model SHALL detect the available runtime and use it for system loading, global styles resolution, and transform resolution.

#### Scenario: Bun available
- **WHEN** `bun` is found in the system PATH
- **THEN** subprocesses SHALL use `bun run <script>` for execution

#### Scenario: Bun not available, node fallback
- **WHEN** `bun` is NOT found in the system PATH
- **THEN** subprocesses SHALL use `node <script>` for execution with CJS-compatible scripts

#### Scenario: Subprocess scripts are CJS-compatible
- **WHEN** a subprocess script is generated for system loading or transform resolution
- **THEN** it SHALL use `require()` and `module.exports` syntax compatible with both bun and node

### Requirement: Verbose timing display in next-plugin
When verbose mode is enabled, the next-plugin SHALL display hierarchical per-phase timing after extraction completes, using the same waterfall format as the vite-plugin. The zero-cost timer gate SHALL ensure no overhead when verbose is off.

#### Scenario: Verbose build shows hierarchical breakdown
- **WHEN** `verbose: true` is configured and a build triggers extraction
- **THEN** the plugin SHALL log the hierarchical waterfall showing JS phases with nested Rust PipelineTiming phases, matching the vite-plugin format

#### Scenario: Non-verbose mode unchanged
- **WHEN** `verbose` is false or not configured
- **THEN** no timing waterfall SHALL be displayed and no `performance.now()` calls SHALL occur
