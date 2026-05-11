## Context

The Rust extraction crate (`packages/extract/src/css_generator.rs`) is the sole authority for intra-layer CSS rule ordering. The current mechanism is a flat `SHORTHAND_PROPERTIES` array (18 entries) and a `css_property_cascade_key()` function that returns either the property's index in that array or `array.len() + 1` for everything else. This produces a binary classification: "known shorthand" vs "longhand."

CSS shorthand relationships form a tree, not a binary. The border family alone has 3 levels: `border` → `borderTop`/`borderWidth` → `borderTopWidth`. The current flat list assigns arbitrary relative ordering to overlapping siblings at the same depth (e.g., `borderTop` at index 1 vs `borderWidth` at index 5) and collapses all leaf longhands to a single key.

Post `remove-core-dependency`, the TS-side `orderPropNames` in `packages/core` is no longer in the extraction path. The Rust crate owns this entirely.

## Goals / Non-Goals

**Goals:**
- Model the CSS shorthand tree depth in the cascade sort key (3 tiers minimum)
- Ensure overlapping sub-shorthands at the same depth get the same tier (resolved by alphabetical secondary sort)
- Maintain the sort key as a pure function of CSS property name — no external state
- Preserve the existing sort comparator shape (cascade_key, property_name, breakpoint, class_name)
- Keep the failure mode safe: unknown properties → leaf tier (highest priority)

**Non-Goals:**
- Nested `@layer` sub-layers (e.g., `@layer system.shorthand, system.longhand`) — sort key is the mechanism
- Changes to the prop config, groups, or virtual prop expansion in `packages/system`
- Changes to the TS-side `orderPropNames` in `packages/core` (legacy, not in extraction path)
- Per-route CSS splitting or RSC integration (this change makes that future work safer, but doesn't implement it)

## Decisions

### Decision 1: Tiered constant arrays instead of a single flat array

Replace `SHORTHAND_PROPERTIES: &[&str]` with two separate arrays:

```rust
const TIER_0_SUPER_SHORTHANDS: &[&str] = &[...];  // ~10 entries
const TIER_1_SUB_SHORTHANDS: &[&str] = &[...];    // ~13 entries
// Tier 2 = everything else (implicit, no array needed)
```

**Rationale:** This is the simplest change that models the tree. The key function checks tier 0 first, then tier 1, then falls through to tier 2. Two arrays + fallback is easier to audit than a nested HashMap or tree structure. The arrays are small enough that linear scan is fast (benchmarking not needed for <30 entries).

**Alternative considered:** A `HashMap<&str, usize>` with explicit key values per property. More flexible but harder to read and audit — you'd need to mentally reconstruct which properties are at which tier. The array approach makes tiers visually obvious.

**Alternative considered:** A tree structure (enum with children). Over-engineered for what is essentially a 3-tier lookup. The CSS spec doesn't go deeper than 3 levels for any property family we support.

### Decision 2: Tier key ranges with gaps

```rust
fn css_property_cascade_key(css_property: &str) -> usize {
    // Tier 0: 0..99   (super-shorthands)
    // Tier 1: 100..199 (sub-shorthands)
    // Tier 2: 200+     (longhands / fallback)
}
```

Return `tier_base + index_within_tier`. The gaps between tiers ensure tier ordering is absolute — no tier 0 property can ever have a key >= 100, no tier 1 property can ever have a key >= 200.

**Rationale:** Gaps allow future insertion of intermediate tiers (e.g., tier 0.5 at range 50-99) without renumbering existing keys. The existing sort comparator doesn't care about key magnitude — only relative ordering. Within the same tier, the index provides deterministic but semantically neutral ordering (supplemented by the alphabetical secondary sort).

**Alternative considered:** Simple tier * 100 + 0 (no intra-tier index). This would work since the secondary sort is alphabetical, but including the index preserves backward-compatible ordering for properties that were already correctly positioned in the old flat list.

### Decision 3: camelCase and kebab-case dual matching preserved

The existing function checks both camelCase (matching the array) and kebab-case (via `camel_to_kebab()`). This is preserved. The Rust crate receives CSS property names in both forms depending on the code path (prop config uses camelCase, CSS declarations use kebab-case).

### Decision 4: No changes to the sort comparator

The 4-level sort at lines 624-656 is unchanged:

```rust
key_a.cmp(&key_b)                                    // tier-aware cascade key
    .then_with(|| css_prop_a.cmp(&css_prop_b))        // alphabetical
    .then_with(|| bp_order(styles_a).cmp(&bp_order(styles_b)))  // breakpoint
    .then_with(|| name_a.cmp(name_b))                 // class name tiebreaker
```

The cascade key just becomes more granular. The comparator consumes it identically.

### Decision 5: Update stale comment, remove `core` reference

The comment `// Mirrors packages/core/src/properties/orderPropNames.ts` is stale. The Rust crate is the sole authority. Update to reflect that the tiered structure is the canonical cascade ordering for the extraction pipeline.

## Risks / Trade-offs

**[Snapshot churn]** → Canary test snapshots will change where sub-shorthands previously had arbitrary ordering. This is expected and represents improved correctness. Mitigation: update snapshots after verifying the new ordering is correct.

**[Incomplete tier enumeration]** → If a sub-shorthand is missing from tier 1, it falls to tier 2 (longhand). It gets higher cascade priority than intended — but only relative to other sub-shorthands, not relative to super-shorthands. Mitigation: audit against the full CSS spec shorthand tree. The border, grid, and background families cover the main cases. Mitigation: missing entries fail toward "too specific" which is safer than "too general."

**[Parity with TS orderPropNames]** → The TS function is legacy and not in the extraction path, but if someone uses it for non-extraction purposes, behavior will diverge. Mitigation: the TS function was already less granular. No action needed unless `core` is resurrected (non-goal).

**[Performance]** → Two linear scans instead of one, on arrays of ~10 and ~13 entries. Negligible. Not worth benchmarking.
