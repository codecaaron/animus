## Why

The CSS shorthand tree has 3+ levels of depth (e.g., `border` → `borderTop`/`borderWidth` → `borderTopWidth` → `borderTopLeftRadius`), but our cascade sort key in the Rust extraction crate treats it as binary: either a property is in the flat `SHORTHAND_PROPERTIES` list (gets a positional index) or it's not (gets a single fallback value). This means overlapping sub-shorthands like `borderTop` and `borderWidth` receive arbitrary relative ordering, and all leaf longhands share the same cascade key regardless of their position in the tree. As we architect for RSC/streaming delivery where CSS chunks may load in unpredictable order, the intra-layer sort key is the sole mechanism guaranteeing cascade correctness — it must model the full tree.

## What Changes

- Replace the flat `SHORTHAND_PROPERTIES` array in `packages/extract/src/css_generator.rs` with a tiered structure that encodes CSS shorthand tree depth (super-shorthands → sub-shorthands → longhands).
- Update `css_property_cascade_key()` to return tier-aware sort keys where tier boundaries are separated by a numeric range, not adjacent indices.
- Overlapping siblings at the same tree depth (e.g., `borderTop` and `borderWidth`) receive the same tier priority — their relative order is resolved alphabetically by property name (existing secondary sort), which is semantically correct since same-depth siblings have no inherent ordering.
- Update the stale comment referencing `packages/core/src/properties/orderPropNames.ts` — the Rust crate is the sole cascade ordering authority post `remove-core-dependency`.

## Capabilities

### New Capabilities
- `tiered-cascade-ordering`: CSS shorthand tree-depth-aware sort key for intra-layer cascade correctness across all utility and slot class emission.

### Modified Capabilities
- `utility-css-generation`: The "single sorted emission stream" requirement's cascade key semantics change from flat positional to tiered tree-depth. The sort comparator shape is unchanged; only the key values become more granular.

## Impact

- **`packages/extract/src/css_generator.rs`**: `SHORTHAND_PROPERTIES` replaced with tiered structure, `css_property_cascade_key()` updated. Sort comparator unchanged.
- **Canary test snapshots**: Utility CSS rule ordering may shift where sub-shorthands previously had arbitrary relative positions. Snapshot updates expected and represent improved correctness.
- **No consumer-facing API changes**: The sort key is an internal mechanism. Component authors and consumers see no behavioral difference unless they were relying on the specific (incorrect) ordering of overlapping shorthands.
- **No changes to**: prop config, groups, virtual prop expansion, builder chain, theme evaluation, HMR bridge, or any TS packages.
