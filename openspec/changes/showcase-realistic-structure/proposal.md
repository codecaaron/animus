## Why

The showcase puts all 22 components in a single `components.tsx` file. This means HMR invalidation is all-or-nothing — changing one system prop on one component resets animation state for all 22. More critically, the extraction pipeline is only tested against the single-file pattern. Real applications use multi-file component directories, barrel re-exports, and cross-file extension chains — patterns that exercise the import resolver, provenance resolution, and file discovery in ways the current structure never touches.

## What Changes

- Split `src/components.tsx` into a `src/components/` directory with individual component files grouped by function
- Add a barrel `src/components/index.ts` that re-exports all components (tests import resolver re-export chain)
- Introduce at least one cross-file extension chain (component in one file extending a base from another)
- Update `App.tsx` imports to use the barrel index
- Optionally test TSConfig path alias patterns if safe (known danger zone — Vite resolve aliases have broken extraction transforms before)
- Visual output of the showcase MUST remain identical — this is a structural refactor only

## Capabilities

### New Capabilities
- `showcase-multi-file-structure`: Requirements for how the showcase organizes components to exercise extraction pipeline patterns (barrel exports, cross-file extensions, grouped subdirectories, per-file HMR granularity)

### Modified Capabilities

## Impact

- `packages/showcase/src/components.tsx` — removed, replaced by directory
- `packages/showcase/src/components/` — new directory with individual files + barrel index
- `packages/showcase/src/App.tsx` — import paths updated
- `packages/showcase/src/SyntaxBlock.tsx` — moves into components directory
- `packages/extract/src/import_resolver.rs` — exercised more heavily (barrel re-exports, cross-file bindings) but likely no code changes needed
- `packages/extract/src/project_analyzer.rs` — exercised more heavily (cross-file provenance) but likely no code changes needed
- If extraction bugs surface during restructure, they become new fix items
