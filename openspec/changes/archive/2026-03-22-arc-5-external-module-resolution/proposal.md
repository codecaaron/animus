## Why

The Layer 5 reality probe revealed that 16 of 24 doc site components are eliminated by the reconciler — not because they're unused, but because the pipeline can't trace their usage through package-name imports. When `pages/index.tsx` imports `{ Box, Text } from '@animus-ui/components'`, the import resolver returns None for the package specifier `@animus-ui/components`. It can't map `Box` in the page back to `Box` defined in `packages/ui/src/elements/Box.tsx`. The component appears unused and is eliminated.

The remaining 8 components that DO extract are used via direct relative imports within the doc site's own component files (e.g., `Button.tsx` renders `<ButtonContainer>` directly). This proves the pipeline works — the gap is specifically in package-name resolution.

Closing this gap moves the doc site from 8/24 components extracted (33%) to potentially 24/24 (100%), completing the Finite Style Machine's coverage of the real codebase. This is the prerequisite for the Emotion exit — extraction cannot replace Emotion until it covers ALL components, and it cannot cover all components without resolving package imports.

Additionally, the 16 eliminated components include the most responsive-heavy ones (LayoutContainer, ContentContainer, SidebarContainer) whose `@media` queries are currently absent from the Layer 5 snapshot. Full extraction coverage will produce significantly richer CSS output with complete responsive breakpoint support.

## What Changes

- **Package resolution map**: The `analyze_project` NAPI function accepts an additional parameter — a JSON map of package specifiers to their resolved entry file paths (e.g., `{ "@animus-ui/components": "packages/ui/src/index.ts" }`). The import resolver uses this map for non-relative imports.
- **Vite plugin pre-resolution**: At `buildStart`, the Vite plugin scans all discovered files for package-name imports matching configurable patterns (default: `@animus-ui/*`), resolves each via Vite's `this.resolve()`, reads the resolved entry files, and includes them in the file entries passed to `analyze_project`.
- **Import resolver package path support**: The `resolve_path` callback (used by `resolve_bindings`) now receives the package resolution map and returns resolved paths for package specifiers.
- **Layer 5 snapshot update**: With package resolution enabled, the doc site snapshot should show significantly more components extracted and more complete CSS output.

## Capabilities

### New Capabilities
- `package-resolution`: Maps package specifiers (e.g., `@animus-ui/components`) to their entry file paths, enabling the import resolver to trace bindings through package boundaries. Supports both monorepo workspaces (resolved via Vite's module resolution) and node_modules packages.

### Modified Capabilities
- `import-resolver`: The `resolve_bindings` function's path resolution callback now handles package specifiers in addition to relative paths, using a pre-built package resolution map.
- `project-analyzer`: `analyze_project` NAPI function accepts an optional package resolution map. The project analyzer passes this to the import resolver's path resolution callback.
- `vite-extraction-plugin`: `buildStart` discovers package-name imports, resolves them via `this.resolve()`, reads entry files, and includes them in the analysis. Configurable via `packagePatterns` option (default: `['@animus-ui/*']`).

## Impact

- **`packages/extract/src/import_resolver.rs`**: resolve_path callback receives package map for non-relative resolution
- **`packages/extract/src/project_analyzer.rs`**: analyze function accepts + threads package resolution map
- **`packages/extract/src/lib.rs`**: analyze_project NAPI function gains optional package_resolution_json parameter
- **`packages/vite-plugin/src/index.ts`**: buildStart scans for package imports, resolves via this.resolve(), includes entry files
- **`packages/extract/tests/canary.test.ts`**: Layer 5 snapshot updated with full extraction coverage
- **No runtime shim changes**: package resolution is purely a build-time concern

## Future Hooks (not implemented in this arc, but enabled by it)

- **Emotion replacement**: Full extraction coverage + the existing `@layer` cascade makes Emotion redundant. The extraction pipeline IS the styling runtime — for both production (static CSS) and dev mode (incremental re-extraction on HMR). Emotion's unlayered CSS is incompatible with `@layer` ordering, making coexistence a bug, not a feature.
- **Dev-mode extraction**: The package resolution map + file dependency graph built here is the foundation for incremental manifest updates on HMR. File changes → re-extract one file → CSS delta → Vite replaces CSS. OXC parses in ~1ms/file.
- **`@layer dynamic`**: Dynamic function values (currently bail) can become CSS variable slots in a highest-priority layer. Runtime only sets variables, not injects rules. This is the SNOWFLAKE strategy from the Finite Style Machine vision.
- **CSS serialization parity audit**: Before fully replacing Emotion, audit that extraction's CSS output matches Emotion's for shorthands, vendor prefixes, and unit conversions.
