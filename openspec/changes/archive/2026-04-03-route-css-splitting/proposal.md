## Why

At scale — hundreds of components across many routes — loading ALL component CSS upfront is wasteful. Hash-scoped component selectors (`.animus-Card-abc123--variant-fill`) can never cascade-conflict with selectors from other components, meaning source order between components is meaningless. Only the system layer (shared utility classes) has intra-layer ordering dependencies. This means we can split component CSS per route without cascade risk — something no other static extraction framework can do because their utility/atomic classes are shared globals with ordering dependencies.

## What Changes

- Rust crate emits per-component CSS fragments (not just per-layer concatenation) associable to component_id in the manifest
- Bundler plugins gain an opt-in `cssSplitting` mode that emits a global chunk (declaration + variables + globals + system) and per-route component CSS chunks
- Per-route chunks contain only the base/variants/compounds/states/custom CSS for components in that route's JS import subgraph
- Components shared across multiple routes are hoisted to a shared chunk or the global chunk (deduplication)
- Single-file delivery remains the default — route splitting is opt-in

## Capabilities

### New Capabilities
- `per-component-css-output`: Rust crate associates CSS fragments with component_id rather than only emitting concatenated per-layer strings. Each component's base/variants/compounds/states/custom CSS is individually addressable.
- `route-css-chunking`: Bundler plugin groups per-component CSS into route-aligned chunks based on the JS import graph. Global chunk always loads first. Per-route chunks are order-independent.
- `css-chunk-deduplication`: Components used across multiple routes are deduplicated into a shared chunk, preventing the same component CSS from appearing in multiple route chunks.

### Modified Capabilities
- `structured-css-sheets`: `CssSheets` gains per-component granularity alongside the existing per-layer strings. The per-layer fields remain for single-file mode.
- `vite-extraction-plugin`: Plugin gains `cssSplitting` option. When enabled, emits multiple CSS assets instead of one virtual module. Default behavior unchanged.

## Impact

- **Rust crate** (`css_generator.rs`, `project_analyzer.rs`): Per-component CSS output alongside existing per-layer concatenation. Manifest gains component → CSS fragment mapping.
- **Vite plugin**: New `cssSplitting` option. When enabled, uses Rollup's `emitFile` to produce per-route CSS chunks. Global chunk via existing virtual module.
- **Next plugin** (future): Same `cssSplitting` option via webpack `emitFile`.
- **No changes to**: extraction pipeline, builder chain, runtime, theming, prop system. This is purely a CSS delivery concern.
- **Prerequisite**: `tiered-cascade-key` should land first for system layer correctness under any splitting scenario.
