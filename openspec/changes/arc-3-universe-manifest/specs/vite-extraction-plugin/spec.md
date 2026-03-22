## MODIFIED Requirements

### Requirement: Two-phase build architecture
The Vite plugin SHALL implement a two-phase build architecture: Phase 1 runs at `buildStart` to produce a UniverseManifest via full-codebase analysis, Phase 2 uses the manifest during per-file `transform` hooks.

#### Scenario: buildStart produces manifest
- **WHEN** Vite runs in production mode and calls `buildStart`
- **THEN** the plugin SHALL: (1) evaluate the theme via `ssrLoadModule()`, (2) serialize config and group registry, (3) glob all source files matching include/exclude patterns, (4) read all file sources, (5) call `analyze_project()` to produce the manifest, (6) store the manifest and its CSS in memory

#### Scenario: transform uses manifest
- **WHEN** a file is processed by the `transform` hook
- **THEN** the plugin SHALL call `transform_file(code, id, manifestJson)` to produce transformed source, rather than calling `extract()` per file

#### Scenario: Development mode remains no-op
- **WHEN** Vite runs in development mode
- **THEN** the plugin SHALL not perform analysis or transformation, leaving Emotion runtime intact

### Requirement: Single global CSS output
The plugin SHALL emit a single virtual CSS module (`virtual:animus/styles.css`) containing ALL extracted CSS from the manifest. Per-file virtual CSS modules are no longer used.

#### Scenario: Global CSS module resolution
- **WHEN** transformed source imports `virtual:animus/styles.css`
- **THEN** the plugin's `resolveId` hook SHALL resolve it and the `load` hook SHALL serve the manifest's complete CSS string

#### Scenario: No duplicate @layer declarations
- **WHEN** multiple files are transformed
- **THEN** the `@layer base, variants, states, system, custom;` declaration SHALL appear exactly ONCE in the global CSS output (from the manifest), not once per file

#### Scenario: CSS import in transformed files
- **WHEN** a file has extracted components
- **THEN** the transformed source SHALL import `virtual:animus/styles.css` — all files share one CSS import path

### Requirement: File discovery via glob
The plugin SHALL discover source files to analyze using configurable glob patterns. The default SHALL include `**/*.{ts,tsx,js,jsx}` within the project root, excluding `node_modules`, `dist`, and test directories.

#### Scenario: Default glob
- **WHEN** `animusExtract()` is called with no `include` option
- **THEN** the plugin SHALL scan `**/*.{ts,tsx,js,jsx}` in the project root, excluding `node_modules/**` and `dist/**`

#### Scenario: Custom include/exclude
- **WHEN** `animusExtract({ include: ['src/**/*.tsx'], exclude: ['src/**/*.test.tsx'] })` is called
- **THEN** the plugin SHALL only analyze files matching `src/**/*.tsx` that don't match `src/**/*.test.tsx`

### Requirement: Package import resolution
The plugin SHALL resolve package-name imports (e.g., `@animus-ui/components`) to their file paths using Vite's module resolution at `buildStart` time. This enables the import resolver to trace component bindings through package boundaries.

#### Scenario: Resolve package import
- **WHEN** a file imports `{ Anchor } from '@animus-ui/components'`
- **THEN** the plugin SHALL resolve `@animus-ui/components` to its entry file path (e.g., `packages/ui/src/index.ts`) and include that file in the analysis, enabling the import resolver to trace `Anchor` to its definition in `packages/ui/src/elements/Anchor.tsx`

#### Scenario: External package not resolved
- **WHEN** a file imports `{ Link } from 'next/link'`
- **THEN** the plugin SHALL NOT attempt to resolve this package — it is external and not part of the animus component graph
