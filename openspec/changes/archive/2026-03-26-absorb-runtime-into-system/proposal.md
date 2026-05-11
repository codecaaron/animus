## Why

System already depends on runtime — the builder chain's `.asElement()` and `.asComponent()` call `createComponent` directly. Renaming runtime to `@animus-ui/react` (as originally planned) would make system depend on a React-named package, defeating the framework-agnostic pretense. The builder chain produces React components; this is a React library. Absorbing runtime into system reduces the consumer install surface from 3 packages to 2 and eliminates a dependency edge that exists only because of historical package separation.

## What Changes

- **Move `createComponent` and all runtime source into `packages/system/src/runtime/`**. The function, types, and prop filtering logic move wholesale.
- **Update `packages/system` exports** to include `createComponent` and runtime types.
- **Update `packages/system/package.json`** — remove `@animus-ui/runtime` dependency. React peer dep already exists; verify version range.
- **Update Rust transform emitter** — change hardcoded import from `@animus-ui/runtime` to `@animus-ui/system`. **BREAKING** for existing extracted output (no external consumers).
- **Update showcase imports** — any `import ... from '@animus-ui/runtime'` becomes `from '@animus-ui/system'`.
- **Remove `packages/runtime` from workspace build order** — stop building and publishing as separate package.
- **Core and theming packages are NOT touched** — they remain as the legacy Emotion runtime.

## Capabilities

### New Capabilities
- `runtime-internalization`: Runtime shim (`createComponent`, prop filtering, class resolution) absorbed into the system package as an internal module

### Modified Capabilities
- `extraction-runtime-shim`: Import path changes from `@animus-ui/runtime` to `@animus-ui/system`
- `vite-extraction-plugin`: Plugin's transform output references new import path
- `system-builder`: Package gains runtime exports alongside builder chain

## Impact

- **packages/system** — gains `src/runtime/` directory, new exports, updated package.json
- **packages/extract** — `transform_emitter.rs` import path change (single string constant)
- **packages/vite-plugin** — no source changes needed (plugin doesn't import runtime directly)
- **packages/showcase** — import path updates
- **packages/runtime** — removed from active workspace, build order, and publish list
- **Consumer API** — `npm install @animus-ui/system @animus-ui/vite-plugin` (was 3 packages, now 2)
- **CI release workflow** — remove runtime from publish job package list

## Progression

This follows `absorb-theming-into-system` (change 1) which merged theming into system. Same pattern: move source, update imports, remove workspace entry.
