## Why

A 5-persona API surface audit (Tailwind migrator, Stitches refugee, DS engineer, CSS purist, indie dev) identified correctness and hygiene issues in `@animus-ui/system` that should be resolved before the 0.1.0 stable release. These are not feature gaps — they're either bugs, dead code, or API surface points that confuse every type of user who encounters them.

### Memoization bug in createComponent (correctness)

`packages/system/src/runtime/index.ts` lines 74-78: `prevDynKey` and `prevDynStyle` are closure-scoped per component TYPE, not per instance. Two instances of the same component with different dynamic system prop values (`<Button mt={4} />` next to `<Button mt={8} />`) share mutable memoization state. The last-rendered instance's cache wins, causing stale style objects on re-renders. Flagged independently by 3 of 5 audit personas.

Fix: replace closure variables with `useRef` per instance. This doesn't change the RSC surface — the component already uses `forwardRef` (client-only). The `.asClass()` path (RSC-safe) doesn't go through createComponent.

### Dead `serialize()` on GlobalStyleBlock (dead code)

`GlobalStyleBlock.serialize()` in SystemBuilder.ts returns its input unchanged — literally `return styles`. The actual global style serialization happens in Rust (`system_loader.rs` extracts `.styles`, `resolve-global-styles.ts` resolves tokens). The TS method is vestigial from before the Rust pipeline took over. It has zero callers.

### `includes()` no-op (API clarity — exploration point)

`SystemBuilder.includes()` accepts an array of systems and ignores them. The parameter is `_systems` (prefixed underscore). It's called in showcase/ds.ts and next-app/ds.ts with `testDs` but has no effect. The method exists for future multi-system composition but currently misleads users into thinking it merges prop registries.

This is a design exploration point, not a direct fix. Options: move to constructor args for clarity, implement the type-level merge, or remove until the feature is ready. The proposal documents the current state; the design will capture the decision.

### Stale active changes (hygiene)

`rc-consumer-surface` (0/22, last modified 2026-04-03) and `vite-integration-patterns` (0/12, last modified 2026-04-12) are untouched and predate the 5-change reorganization sequence. Archive as stale.

## What Changes

- Fix memoization in `createComponent` to be per-instance via `useRef`
- Remove dead `serialize()` method from `GlobalStyleBlock`
- Document `includes()` current state and capture design decision for its future
- Archive 2 stale openspec changes

## Capabilities

### Modified Capabilities
- `runtime-component-rendering`: createComponent dynamic style memoization becomes per-instance (correctness fix)

## Impact

- `packages/system/src/runtime/index.ts` — memoization fix (useRef replaces closure vars)
- `packages/system/src/SystemBuilder.ts` — remove dead `serialize()` method from GlobalStyleBlock
- `packages/system/src/SystemBuilder.ts` — `includes()` documented as exploration point
- `openspec/changes/rc-consumer-surface/` → archived
- `openspec/changes/vite-integration-patterns/` → archived
