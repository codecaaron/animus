## 1. Dependency & Data Structure

- [x] 1.1 Enable `preserve_order` feature on `serde_json` in `packages/extract/Cargo.toml`
- [x] 1.2 Verify Rust crate compiles with `IndexMap`-backed `serde_json::Map`

## 2. Cascade-Tier Sort Function

- [x] 2.1 Add `CSS_SHORTHANDS` constant in `theme_resolver.rs` (mirrors `SHORTHAND_PROPERTIES` from `css_generator.rs`)
- [x] 2.2 Add `prop_cascade_tier(prop_name, config) -> (usize, usize)` function — returns `(tier, specificity)` tuple for sort comparison
- [x] 2.3 Add unit test for `prop_cascade_tier`: verify `p` < `px` < `pl` ordering, and that unknown/pass-through props sort last

## 3. Apply Sorting in Resolution

- [x] 3.1 In `resolve_styles()`: collect `obj.iter()` into sorted vec using `prop_cascade_tier` before iterating — use stable sort to preserve `IndexMap` insertion order within tiers
- [x] 3.2 In `resolve_flat_styles()`: same cascade-tier sorting before iterating
- [x] 3.3 Add integration-level test: `{ px: 3, pl: 8 }` produces CSS where `pl`'s `padding-left` appears after `px`'s `padding-left`

## 4. Verify & Update Snapshots

- [x] 4.1 Run `cargo test --lib` — fix any compile errors from `IndexMap` type changes
- [x] 4.2 Run `bun run test:canary` — update inline snapshots where declaration order shifted
- [x] 4.3 Run `bun run verify` — confirm full TS + test suite passes
