## Why

Every extracted component with system props currently embeds its own `systemProps` class map — a `{ propName: { valueKey: className } }` object — in its `createComponent()` config. When multiple components share the same groups (space, layout, color), this duplicates identical prop→className lookup tables across N component files. This creates two problems: (1) unnecessary JS bundle weight from repeated string→string maps, and (2) HMR invalidation storms where a single utility class hash change forces re-transformation of every component file that embeds it.

## What Changes

- **Extract system prop class maps into a single shared virtual module** (`virtual:animus/system-props`). This module exports the global `{ propName: { valueKey: className } }` map, built once from the full extraction manifest.
- **Slim down per-component `createComponent()` configs** to only carry `systemPropNames` (a string array declaring which props to intercept). The value→className resolution moves to the shared module.
- **Modify the runtime shim** to import the shared map and resolve system props from it rather than from per-component config. **BREAKING** for existing `createComponent()` config shape — `systemProps` key removed from per-component config.
- **Add a new virtual module** in the Vite plugin for serving and HMR-invalidating the shared map.
- **Modify Rust transform emitter** to stop embedding `systemProps` in per-component replacement output and instead produce the shared map as a separate artifact.

## Capabilities

### New Capabilities
- `shared-system-prop-map`: The centralized virtual module that holds the global prop→value→className map, served by the Vite plugin, imported by the runtime, and produced by the Rust extraction pipeline as a distinct artifact.

### Modified Capabilities
- `extraction-runtime-shim`: `createComponent` config shape changes — `systemProps` removed from per-component config, replaced by import from shared module. `systemPropNames` remains per-component.
- `vite-extraction-plugin`: New virtual module `virtual:animus/system-props` for serving the shared map, with HMR invalidation when utility classes change.

## Impact

- **packages/extract** (Rust): `transform_emitter.rs` stops emitting `systemProps` in `ComponentReplacement`. `lib.rs` produces the shared map as a separate output field from `analyzeProject`.
- **packages/runtime** (TS): `createComponent` imports shared map module, resolves system props from it. Config type changes (removes `systemProps`).
- **packages/vite-plugin** (TS): Serves `virtual:animus/system-props` virtual module alongside existing `virtual:animus/styles.css`. Handles HMR invalidation for the map module.
- **packages/showcase** and any consumer: No source changes needed — the builder API is unchanged. Only the extracted output changes shape.
- **Bundle size**: Net reduction from deduplicating repeated map objects across components.
- **HMR**: Utility class changes invalidate one shared module instead of N component files. Re-renders propagate via import graph (cheap) instead of re-transforms (expensive).
