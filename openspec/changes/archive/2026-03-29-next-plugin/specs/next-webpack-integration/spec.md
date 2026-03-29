## ADDED Requirements

### Requirement: Webpack plugin lifecycle
The Next.js webpack plugin SHALL hook into the webpack compiler lifecycle to run project analysis once per build and share the resulting manifest across all compilation passes (server, client, edge).

#### Scenario: Single analysis per build
- **WHEN** Next.js webpack creates multiple compiler instances (server, client, edge)
- **THEN** `analyze_project()` SHALL execute exactly once, and all compilers SHALL share the same cached manifest

#### Scenario: Analysis runs before module resolution
- **WHEN** the webpack plugin's `beforeCompile` hook fires
- **THEN** the plugin SHALL have completed `analyze_project()` and written the CSS output file before any module resolution begins

#### Scenario: Analysis race condition
- **WHEN** two compiler instances reach the analysis hook simultaneously
- **THEN** the first SHALL execute analysis and the second SHALL await the result, not run a duplicate analysis

### Requirement: Webpack loader transforms
The webpack loader SHALL call `transform_file()` per-file using the cached manifest from the plugin. The loader SHALL be registered for `.ts`, `.tsx`, `.js`, and `.jsx` files excluding `node_modules`.

#### Scenario: File with Animus components
- **WHEN** the loader processes a file containing builder chain expressions
- **THEN** it SHALL call `transform_file(source, relativePath, manifestJson)` and return the transformed code with `createComponent` imports

#### Scenario: File without Animus components
- **WHEN** the loader processes a file with no builder chains
- **THEN** `transform_file()` SHALL return the source unchanged with `has_components: false`, and the loader SHALL pass through the original source

#### Scenario: Loader excludes node_modules
- **WHEN** webpack resolves a module inside `node_modules/`
- **THEN** the loader SHALL NOT process that file

### Requirement: CSS output as real file
The webpack plugin SHALL write the extracted CSS to a real file on disk at `.animus/styles.css` relative to the project root. This file SHALL contain the complete `@layer`-ordered CSS output from `analyze_project()`.

#### Scenario: CSS file written at build start
- **WHEN** the webpack plugin completes analysis
- **THEN** it SHALL write the resolved CSS (variable declarations + global styles + component CSS) to `.animus/styles.css`

#### Scenario: CSS file includes all layers
- **WHEN** the CSS file is written
- **THEN** it SHALL contain the layer declaration, variable CSS, global styles CSS, and all component CSS in `@layer` order — matching the Vite plugin's production output

#### Scenario: Directory created if missing
- **WHEN** the `.animus/` directory does not exist
- **THEN** the plugin SHALL create it before writing the CSS file

### Requirement: System loading via subprocess
The webpack plugin SHALL load the design system module via bun subprocess at build start, identical to the Vite plugin's `loadSystem()` mechanism.

#### Scenario: System loaded from option path
- **WHEN** `withAnimus(nextConfig, { system: './src/ds.ts' })` is configured
- **THEN** the plugin SHALL invoke a bun subprocess to import the system module and call `.serialize()`, returning tokens, propConfig, groupRegistry, and transforms

#### Scenario: Transform post-processing
- **WHEN** extracted CSS contains `__TRANSFORM__` placeholders
- **THEN** the plugin SHALL resolve them using the in-memory transform registry from the system's serialized config — same resolution logic as the Vite plugin

#### Scenario: Unit fallback applied
- **WHEN** CSS contains bare numeric values on non-unitless properties
- **THEN** the plugin SHALL apply `applyUnitFallback()` — same function as the Vite plugin
