## MODIFIED Requirements

### Requirement: Plugin factory function
The plugin factory SHALL accept a `system` option pointing to the module that exports the SystemInstance. Additionally, it SHALL accept optional `targets` (browserslist query string or array), `minify` (boolean), `strict` (boolean), `prefix` (string), and `layers` (string array) options. External package discovery is driven by `.includes()` calls in the system file — no explicit `packages` option is needed. System loading SHALL use the `loadSystemModule()` NAPI function (Rust-internal OXC + rquickjs) — no subprocess or runtime detection needed.

#### Scenario: System instance path
- **WHEN** consumer configures `animusExtract({ system: './src/ds.ts' })`
- **THEN** the plugin SHALL load that module via NAPI `loadSystemModule()` to obtain tokens, prop config, group registry, selector aliases, selector order, and global style blocks

#### Scenario: No subprocess or runtime detection
- **WHEN** system loading occurs at buildStart
- **THEN** no `bun` or `node` subprocess SHALL be spawned — `loadSystemModule()` handles file reading, OXC type stripping, dependency resolution, and rquickjs evaluation internally

## ADDED Requirements

### Requirement: Dead subprocess code removed
The vite-plugin SHALL NOT contain any subprocess-related source files or imports. The `resolve-global-styles.ts` standalone script SHALL be deleted.

#### Scenario: No subprocess files
- **WHEN** the vite-plugin source directory is listed
- **THEN** `resolve-global-styles.ts` SHALL NOT exist

#### Scenario: No subprocess references in comments
- **WHEN** vite-plugin source is searched for "subprocess"
- **THEN** zero matches SHALL be found in source comments (JSDoc and inline)

### Requirement: Fragment-aware HMR splice
In dev mode, the vite-plugin SHALL use per-component CSS fragments from the manifest to enable targeted HMR updates. On file change, only the changed file's component fragments SHALL be replaced in the cached fragment set before re-concatenating affected layers.

#### Scenario: Single file change updates only its fragments
- **WHEN** a file containing 3 components is edited during dev
- **THEN** only those 3 components' fragments SHALL be recomputed via re-analysis
- **AND** fragments for all other components SHALL be preserved from cache

#### Scenario: Extension chain invalidation
- **WHEN** a file containing a parent component is edited
- **THEN** fragments for all descendant components (via reverse_provenance BFS) SHALL also be invalidated and recomputed
