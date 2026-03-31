## 1. Tiered Structure

- [ ] 1.1 Replace `SHORTHAND_PROPERTIES` flat array with `TIER_0_SUPER_SHORTHANDS` and `TIER_1_SUB_SHORTHANDS` arrays in `packages/extract/src/css_generator.rs`
- [ ] 1.2 Populate tier 0 with super-shorthands: `border`, `background`, `flex`, `margin`, `padding`, `gap`, `grid`, `transition`, `overflow`, `outline`
- [ ] 1.3 Populate tier 1 with sub-shorthands — border family: `borderTop`, `borderRight`, `borderBottom`, `borderLeft`, `borderWidth`, `borderStyle`, `borderColor`, `borderRadius`, `borderImage`; grid family: `gridTemplate`, `gridArea`, `gridColumn`, `gridRow`

## 2. Key Function

- [ ] 2.1 Update `css_property_cascade_key()` to check tier 0 first (return 0..99 range), tier 1 second (return 100..199 range), and fall through to tier 2 (return 200) for leaf longhands
- [ ] 2.2 Preserve camelCase + kebab-case dual matching via `camel_to_kebab()`
- [ ] 2.3 Update the stale comment block (lines 10-15) to remove the `orderPropNames.ts` reference and document the tiered model

## 3. Verification

- [ ] 3.1 Run `bun run test:canary` — expect snapshot changes where sub-shorthand ordering improves
- [ ] 3.2 Update canary test snapshots to reflect new ordering
- [ ] 3.3 Run `bun run verify` to confirm full pipeline passes (build:ts + test + biome check)
- [ ] 3.4 Spot-check a snapshot diff to confirm: tier 0 properties appear before tier 1, tier 1 before tier 2, overlapping siblings (e.g., `border-top` and `border-width`) are now in the same tier and alphabetically ordered
