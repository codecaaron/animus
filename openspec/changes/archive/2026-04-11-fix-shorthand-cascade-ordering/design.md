## Context

The Rust extraction crate converts DS style objects (e.g., `{ px: 3, py: 2, pl: 8 }`) from AST into `serde_json::Value`, then iterates object keys in `resolve_styles()` to produce `Vec<CssDeclaration>`. Default `serde_json` uses `BTreeMap` for JSON objects — alphabetical key ordering. This destroys the cascade relationship between shorthand and longhand DS props.

The legacy Emotion runtime solved this in `packages/core/src/properties/orderPropNames.ts` with a comparator that sorts props by their CSS property's shorthand status: true shorthands first, multi-target shorthands second, direct longhands last. The Rust crate has `SHORTHAND_PROPERTIES` and `css_property_cascade_key()` in `css_generator.rs` but only applies them to utility CSS (system/custom layers). Component base/variant/state styles receive no ordering treatment.

## Goals / Non-Goals

**Goals:**
- Multi-property shorthand props (`px`, `py`, `mx`, `my`) always emit CSS declarations before their directional longhand counterparts (`pl`, `pr`, `pt`, `pb`, etc.)
- Ordering applies uniformly across all emission paths: base styles, variant styles, state styles, pseudo-selector blocks, and responsive blocks
- Source insertion order preserved as tiebreaker within the same cascade tier

**Non-Goals:**
- Deduplication of overlapping declarations (both `padding-left` values still emit — cascade handles precedence)
- Changes to utility CSS ordering (already correct via `css_property_cascade_key`)
- Changes to PropConfig structure or the DS property definitions
- Consumer-side Vite/build configuration changes

## Decisions

### 1. Enable `serde_json` `preserve_order` feature

**Choice**: Add `features = ["preserve_order"]` to serde_json in Cargo.toml.

**Why**: Switches `serde_json::Map` from `BTreeMap` to `IndexMap`. The style evaluator builds Value objects from OXC AST which preserves source order — `IndexMap` carries that through. This provides correct tiebreaking within cascade tiers and makes CSS output predictable relative to source.

**Alternative considered**: Leave `BTreeMap` and rely solely on cascade-tier sorting. Rejected because within the same tier, source order is the only meaningful tiebreaker — alphabetical is arbitrary and surprising.

### 2. Cascade-tier sorting in `theme_resolver.rs`, not `css_generator.rs`

**Choice**: Add `prop_cascade_tier()` function and sorting logic in `theme_resolver.rs` where `resolve_styles()` and `resolve_flat_styles()` live.

**Why**: The ordering must happen before declarations are built from props. By the time declarations reach `css_generator.rs`, the prop-level context (which config entry generated which declarations) is lost — you only have `CssDeclaration { property, value }`. The prop config lookup that determines shorthand status must happen while we still have prop names and access to `PropConfigMap`.

**Alternative considered**: Tag each `CssDeclaration` with a cascade-tier field and sort in css_generator. Rejected — adds a field to every declaration for a concern that belongs at resolution time, not emission time.

### 3. Three-tier ordering model mirroring `orderPropNames.ts`

**Tier 0**: Prop's `property` field is in `CSS_SHORTHANDS` AND `properties` is empty → true CSS shorthand (e.g., `p` → `padding`)
**Tier 1**: Prop's `property` field is in `CSS_SHORTHANDS` AND `properties` is non-empty → multi-target shorthand (e.g., `px` → `paddingLeft` + `paddingRight`). Within tier 1, more properties = less specific = sorts earlier.
**Tier 2**: Prop's `property` field is NOT in `CSS_SHORTHANDS` → direct longhand (e.g., `pl` → `paddingLeft`)
**Tier 3**: No config entry → pass-through CSS property, sorts last

Within each tier, `IndexMap` insertion order (= source order) is preserved via stable sort.

### 4. Separate `CSS_SHORTHANDS` list in `theme_resolver.rs`

**Choice**: Define a `CSS_SHORTHANDS` constant in `theme_resolver.rs` rather than importing from `css_generator.rs`.

**Why**: `css_generator.rs` imports from `theme_resolver.rs` (types, `resolve_styles`). Importing back would create a circular dependency. The lists serve different purposes — `css_generator`'s list orders CSS properties for utility emission, `theme_resolver`'s list orders DS prop names during resolution.

## Risks / Trade-offs

- **Snapshot churn**: Canary test inline snapshots may shift declaration order where shorthand props existed alongside longhands. Manageable — update snapshots after verification.
- **IndexMap performance**: `IndexMap` is marginally slower than `BTreeMap` for lookups. Negligible at the scale of style objects (typically <20 keys per object).
- **Dual shorthand lists**: Two copies of the CSS shorthands list (`css_generator.rs` and `theme_resolver.rs`). Acceptable — they serve different purposes and the list is stable CSS spec.
