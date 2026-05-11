## Why

Multi-property shorthand DS props (`px`, `py`, `mx`, `my`) don't respect CSS cascade ordering against their directional longhand counterparts (`pl`, `pr`, `pt`, `pb`, `ml`, `mr`, `mt`, `mb`). Writing `px: 3, pl: 8` should produce CSS where `pl`'s `padding-left` overrides `px`'s, but the Rust crate emits them in `serde_json` `BTreeMap` alphabetical order — `pl` before `px` — so `px` wins instead. The legacy Emotion runtime solved this with `orderPropNames.ts`; the extraction pipeline has no equivalent.

## What Changes

- Enable `serde_json` `preserve_order` feature so JSON object iteration uses `IndexMap` (insertion-ordered) instead of `BTreeMap` (alphabetical)
- Add cascade-tier sorting in `theme_resolver.rs` that mirrors the legacy `orderPropNames.ts` logic: true CSS shorthands → multi-target shorthands → direct longhands
- Apply this sorting in `resolve_styles()` and `resolve_flat_styles()` before iterating object keys, so all emitted CSS respects shorthand-before-longhand ordering regardless of source order

## Capabilities

### New Capabilities
- `prop-cascade-ordering`: Cascade-tier sorting for DS props during style resolution — ensures multi-property shorthand props emit before their directional longhand overrides in all CSS emission paths (base, variants, states, pseudo-selectors)

### Modified Capabilities

## Impact

- `packages/extract/Cargo.toml` — new serde_json feature flag
- `packages/extract/src/theme_resolver.rs` — cascade-tier sort function + sorting in resolve_styles/resolve_flat_styles
- All existing canary/integration test CSS snapshots may shift declaration order (shorthands move earlier) — snapshot updates expected
- No API changes, no breaking changes, no consumer-side fixes needed
