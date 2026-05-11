## 1. Revert sidecar specificity engineering

- [ ] 1.1 Revert inheritance selector from `.{variant_class} .{child_class}` (0,2,0) back to `.{root_class}.{variant_class} .{child_class}` (0,3,0) in `write_composed_rule_pair()` — the sublayer will handle ordering, not specificity tiers
- [ ] 1.2 Remove sidecar default rule emission from the Variants arm of `generate_layer_content()` and `generate_layer_content_ordered()` — sidecar moves to sublayer-aware emission path
- [ ] 1.3 Keep `VariantCss.default_option` field and runtime `--{prop}-default` class emission in `resolveClasses.ts` — the sidecar concept is retained, only its emission location changes

## 2. Sublayer emission in css_generator.rs

- [ ] 2.1 Add a `has_compose_families: bool` parameter (or equivalent context) to `generate_css()` and `generate_sheets_from_slice()` to control sublayer provisioning
- [ ] 2.2 When `has_compose_families` is true, wrap variant rule output in `@layer standalone { }` block with `@layer standalone, composed;` declaration preceding it inside `@layer variants { }`
- [ ] 2.3 Re-emit sidecar default rules inside the `@layer standalone` block (same rules, new location)
- [ ] 2.4 Modify `generate_composed_variant_css()` output to be wrapped in `@layer composed { }` when sublayer provisioning is active

## 3. Sublayer integration in project_analyzer.rs

- [ ] 3.1 Replace string-surgery append (truncate closing brace + re-close) with structured sublayer assembly: combine standalone content and composed content into `@layer variants { @layer standalone, composed; @layer standalone { ... } @layer composed { ... } }`
- [ ] 3.2 Pass compose family presence flag from `project_analyzer` into the CSS generation path so `generate_css` / `generate_sheets` can conditionally provision sublayers
- [ ] 3.3 When no compose families exist, emit flat `@layer variants { ... }` with no sublayer structure (unchanged behavior)

## 4. Composed compound sublayers

- [ ] 4.1 Identify compound conditions that reference shared variant props by cross-referencing `CompoundVariant` conditions against `ComposeFamilyInfo.shared_keys`
- [ ] 4.2 For compounds with shared-prop conditions, emit composed compound rules: substitute parent inheritance selector for the shared prop dimension (`.Root--size-sm .Child.Child--intent-primary`)
- [ ] 4.3 Wrap standalone compound rules in `@layer compounds { @layer standalone { } }` and composed compound rules in `@layer compounds { @layer composed { } }` when composed compounds exist
- [ ] 4.4 When no composed compounds exist, emit flat `@layer compounds { ... }` (unchanged behavior)

## 5. Update canary tests

- [ ] 5.1 Update compose variant test assertions for sublayer-wrapped output (`@layer variants { @layer standalone, composed; ... }`)
- [ ] 5.2 Update inheritance selector assertions back to (0,3,0) pattern (`.Root.Root--var-opt .Child`)
- [ ] 5.3 Verify sidecar default rule appears inside `@layer standalone` block
- [ ] 5.4 Add canary test for non-compose project producing flat layers (no sublayer declarations)

## 6. Update integration tests

- [ ] 6.1 Update `composition.test.ts` assertions for sublayer structure in CSS output
- [ ] 6.2 Verify inheritance and override regex patterns match new sublayered output
- [ ] 6.3 Add test case: component with compose family AND standalone usage — verify rules appear in correct sublayers
- [ ] 6.4 Verify non-compose extraction tests pass unchanged (no sublayer structure in their output)

## 7. Verify end-to-end

- [ ] 7.1 Run `bun run test:canary` — all Rust extraction tests pass
- [ ] 7.2 Run `bun run verify` — full TS build + test + biome check
- [ ] 7.3 Run `bun run verify:showcase` — showcase builds with sublayered CSS
- [ ] 7.4 Inspect showcase compose examples in browser devtools — verify layer badges show `variants.standalone` and `variants.composed`
