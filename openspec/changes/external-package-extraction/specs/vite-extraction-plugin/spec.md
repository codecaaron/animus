## MODIFIED Requirements

### Requirement: Plugin factory function
The plugin factory SHALL accept a `system` option pointing to the module that exports the SystemInstance. Additionally, it SHALL accept optional `targets` (browserslist query string or array), `minify` (boolean), `strict` (boolean), `prefix` (string), and `layers` (string array) options. External package discovery is driven by `.includes()` calls in the system file — no explicit `packages` option is needed.

#### Scenario: System instance path
- **WHEN** consumer configures `animusExtract({ system: './src/ds.ts' })`
- **THEN** the plugin SHALL load that module via a single bun subprocess to obtain tokens, prop config, group registry, and transforms

#### Scenario: External packages discovered from .includes()
- **WHEN** the system file contains `.includes([testDs])` with `import { ds as testDs } from '@animus-ui/test-ds'`
- **THEN** the plugin SHALL discover `@animus-ui/test-ds` from the `.includes()` call, resolve it, and include its source files in extraction

#### Scenario: No .includes() means no external packages
- **WHEN** the system file has no `.includes()` call
- **THEN** no external packages are discovered — only app source files are extracted

### Requirement: External package module resolution redirect
For discovered external packages with a `src/index.ts`, the plugin SHALL redirect module resolution so the bundler serves source files instead of dist files. This ensures the transform hook processes `.ts` source (with builder chains) rather than `.mjs` dist (which fails extension filters).

#### Scenario: Vite resolveId redirect
- **WHEN** `@animus-ui/test-ds` has `src/index.ts` and the Vite dev server or build resolves the specifier
- **THEN** the plugin's `resolveId` hook returns the absolute path to `src/index.ts`

#### Scenario: Webpack NormalModuleReplacement redirect
- **WHEN** `@animus-ui/test-ds` has `src/index.ts` and webpack resolves the specifier
- **THEN** the `NormalModuleReplacementPlugin` `beforeResolve` hook rewrites the request to `src/index.ts`

#### Scenario: No src/ — no redirect
- **WHEN** a discovered package does NOT have `src/` (npm-installed, dist only)
- **THEN** no redirect occurs — the bundler resolves to dist normally

### Requirement: External package transform/loader exemption
Files under discovered external package directories SHALL bypass extension filters and node_modules exclusion in the transform hook (Vite) and loader rule (Next/webpack). The manifest check is the authoritative gatekeeper.

#### Scenario: Vite transform processes external package files
- **WHEN** a file's path starts with an external package directory prefix
- **THEN** the transform hook skips the `\.[jt]sx?$` extension check and the `node_modules` guard — the manifest check alone determines whether to transform

#### Scenario: Webpack loader processes external package files
- **WHEN** a file's path starts with an external package directory prefix
- **THEN** the loader's `test` function accepts `.mjs` files and the `exclude` function allows files inside `node_modules`

#### Scenario: Non-external node_modules still excluded
- **WHEN** a file is in `node_modules` but NOT under any external package directory
- **THEN** the standard `node_modules` exclusion applies

### Requirement: External package HMR in dev mode
In dev mode, edits to workspace-linked external package files SHALL trigger the HMR handler. The `node_modules` exclude pattern in the HMR handler SHALL be bypassed for files under external package directories.

#### Scenario: Workspace-linked package file change triggers HMR
- **WHEN** a file in a workspace-linked external package changes during dev
- **THEN** the HMR handler SHALL process it: content-hash check, re-analysis, module invalidation

#### Scenario: Non-external node_modules changes still excluded
- **WHEN** a file in `node_modules/react` changes
- **THEN** the HMR handler SHALL skip it via the standard exclude pattern
