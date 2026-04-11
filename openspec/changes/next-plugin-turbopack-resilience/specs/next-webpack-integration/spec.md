## REMOVED Requirements

### Requirement: AnimusWebpackPlugin class
**Reason**: The Webpack plugin class (`compiler.hooks.run`, `compiler.hooks.watchRun`) is incompatible with Turbopack. Extraction timing is handled by prebuild-extraction instead.
**Migration**: No consumer action needed — the plugin class was internal.

### Requirement: NormalModuleReplacementPlugin for virtual modules
**Reason**: Virtual module resolution via Webpack-specific plugin is replaced by physical files + resolve aliases that work in both Webpack and Turbopack.
**Migration**: No consumer action needed — virtual modules are replaced transparently.

### Requirement: Cross-compiler Promise deduplication
**Reason**: `singleton.ts` Promise coordination is unnecessary when extraction runs before any compiler boots. There is no race because there is no concurrent execution.
**Migration**: No consumer action needed — internal implementation detail.

## MODIFIED Requirements

### Requirement: Atomic CSS file writes
CSS output SHALL be written atomically to prevent partial reads by concurrent bundler processes.

#### Scenario: Concurrent read during write
- **WHEN** a bundler process reads `.animus/styles.css` while the watcher is rewriting it
- **THEN** the reader SHALL see either the old complete file or the new complete file, never a partial write

#### Scenario: Atomic write mechanism
- **WHEN** the extraction pipeline writes updated CSS
- **THEN** it SHALL write to `.animus/styles.css.tmp` first, then `renameSync()` to `.animus/styles.css`
