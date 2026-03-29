## Why

The `createSystem` API has a nested builder-within-a-builder: `.withProperties((p) => p.addGroup(...).addGroup(...).build())` requires a callback, an inner `PropertyBuilder`, and an inner `.build()` call — two chains, two terminals. This is the last clunky piece before the system API is finalized for v0.10. Additionally, the component chain method `.groups()` doesn't match its cascade layer name (`@layer system`), and props cannot appear in multiple groups without accidental-correctness via JS object spread.

## What Changes

- **BREAKING**: Remove `PropertyBuilder` class — `.addGroup()` and `.addProps()` move directly onto `SystemBuilder`
- **BREAKING**: Remove `.withProperties()` callback wrapper — groups are added via direct chaining
- **BREAKING**: Rename `.groups()` to `.system()` on the component builder chain to match `@layer system`
- Add `.addProps()` method on `SystemBuilder` for registering ungrouped props (registered for token resolution and transforms, but not activatable as a named group)
- **Overlap tolerance**: Props with identical definitions can appear in multiple `.addGroup()` calls — the prop is registered once but belongs to all groups that include it
- **Mixed namespace activation**: `.system()` on components accepts both group names and individual prop names (e.g., `.system(['surface', 'ratio'])` — `surface` is a group, `ratio` is a single prop)
- **Collision constraint**: Group names and prop names must be disjoint — the builder enforces this at the type level to prevent ambiguity in the `.system()` activation namespace
- Single chain, single `.build()`, single rhythm

## Capabilities

### New Capabilities
- `flat-system-builder`: Flattened SystemBuilder with direct `.addGroup()` / `.addProps()` chaining, overlap-tolerant prop registration, and single `.build()` terminal
- `system-layer-activation`: Renamed `.system()` method on component chain with mixed namespace (group names + individual prop names)

### Modified Capabilities
<!-- No existing openspec specs to modify -->

## Impact

- `packages/system/src/SystemBuilder.ts` — Major rewrite: absorb PropertyBuilder methods, add overlap detection, change build return
- `packages/system/src/PropertyBuilder.ts` — DELETE
- `packages/system/src/Animus.ts` — Rename `.groups()` to `.system()`, update type-state class hierarchy
- `packages/system/src/AnimusExtended.ts` — Same rename
- `packages/system/src/index.ts` — Remove PropertyBuilder export, update types
- `packages/system/src/types/` — Update group activation types to support mixed namespace
- `packages/extract/src/jsx_scanner.rs` — If `.groups()` call detection exists, update to `.system()`
- `packages/vite-plugin/` — If transform references `.groups()`, update
- `packages/showcase/src/ds.ts` — Rewrite system definition to use flat chaining
- `packages/showcase/src/components/` — Rename all `.groups([...])` calls to `.system([...])`
- All existing tests referencing `.groups()` or `PropertyBuilder`
