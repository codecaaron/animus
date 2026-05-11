## Why

Every extracted component with system props currently embeds its own `systemProps` class map — a `{ propName: { valueKey: className } }` object — in its `createComponent()` config. When multiple components share the same groups (space, layout, color), this duplicates identical prop→className lookup tables across N component files. Additionally, each component inlines the full `systemPropNames` array (30-50 string literals) even when multiple components use the same groups.

This creates two problems: (1) unnecessary JS bundle weight from repeated data, and (2) HMR invalidation storms where a single utility class hash change forces re-transformation of every component file that embeds it.

## What Changes

- **Extract system prop class maps into a single shared virtual module** (`virtual:animus/system-props`). This module exports the global `{ propName: { valueKey: className } }` map, built once from the full extraction manifest. Custom props (`.props()`) excluded — they stay per-component.
- **Export group prop name arrays alongside the shared map** (`systemPropGroups`). Each group's prop names are stored once in the virtual module. Components reference them via `[].concat(systemPropGroups.space, systemPropGroups.color)` instead of inlining literal arrays.
- **Slim down per-component `createComponent()` configs** — `systemProps` removed, `systemPropNames` replaced with group concat references. The value→className resolution moves to the shared module.
- **Modify the runtime shim** — `createComponent` gains optional 4th parameter for the shared map. **BREAKING** for existing config shape (internal API only).
- **Add a new virtual module** in the Vite plugin for serving and HMR-invalidating the shared map + group arrays.
- **Modify Rust transform emitter** to emit group references and shared map artifact.

## Capabilities

### New Capabilities
- `shared-system-prop-map`: The centralized virtual module that holds the global prop→value→className map AND per-group prop name arrays, served by the Vite plugin, imported by the runtime, and produced by the Rust extraction pipeline as a distinct artifact.

### Modified Capabilities
- `extraction-runtime-shim`: `createComponent` gains 4th parameter. Config shape changes — `systemProps` removed, `systemPropNames` built from group references.
- `vite-extraction-plugin`: New virtual module `virtual:animus/system-props` for serving the shared map + group arrays, with HMR invalidation.

## Impact

- **packages/extract** (Rust): `transform_emitter.rs` emits group concat refs + shared map import. `project_analyzer.rs` produces shared map as manifest field. `ComponentReplacement` gains `system_group_names`.
- **packages/system** (TS): `createComponent` signature gains optional 4th param. Config type updated.
- **packages/vite-plugin** (TS): Serves `virtual:animus/system-props` exporting `systemPropMap` + `systemPropGroups`.
- **Bundle size**: 294KB → 263KB (31KB / 10.5% reduction from deduplication).
- **HMR**: Utility class changes invalidate one shared module instead of N component files.
