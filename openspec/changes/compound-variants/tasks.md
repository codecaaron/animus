## 1. TypeScript Builder Chain

- [ ] 1.1 Add `CompoundEntry` type to `packages/system/src/types/config.ts` — `{ condition: Record<string, string>, styles: ThemedCSSProps<any, any> }`
- [ ] 1.2 Add `compounds` instance array to `AnimusWithVariants` class in `Animus.ts`
- [ ] 1.3 Add `.compound(condition, styles)` method on `AnimusWithVariants` — pushes to array, returns `this`. Condition typed as `{ [K in keyof Variants]?: keyof Variants[K]['variants'] }`
- [ ] 1.4 Update `_buildComponentConfig()` on `AnimusWithAll` to include `compounds` array in returned config when non-empty
- [ ] 1.5 Add type regression tests in `types.test-d.tsx` — compound condition keys constrained to variant names, values constrained to variant options, invalid keys/values rejected via `@ts-expect-error`

## 2. Cascade Layer Update

- [ ] 2.1 Update layer declaration string in `packages/vite-plugin/src/index.ts` — add `compounds` between `variants` and `states`
- [ ] 2.2 Update layer declaration in Rust `css_generator.rs` if the layer string is generated there

## 3. Rust Extraction Pipeline

- [ ] 3.1 Add `"compound"` to `CHAIN_METHODS` in `chain_walker.rs`
- [ ] 3.2 Parse `.compound()` calls — extract condition object (first arg) and styles object (second arg) as two spans per call
- [ ] 3.3 Add `compounds: Vec<CompoundDescriptor>` to `ChainDescriptor` struct where `CompoundDescriptor` has `condition: HashMap<String, String>` and `styles` span
- [ ] 3.4 Evaluate compound style objects in `style_evaluator.rs` using same pipeline as variant styles
- [ ] 3.5 Generate `@layer compounds { }` block in `css_generator.rs` with class naming `animus-{Name}-{hash}--compound-{index}`
- [ ] 3.6 Add `compounds` field to `ComponentReplacement` in `transform_emitter.rs` — array of `{ conditions, className }`
- [ ] 3.7 Emit `compounds` in `createComponent` config when non-empty
- [ ] 3.8 Handle compound inheritance in `chain_merger.rs` — extension inherits parent compounds, own compounds appended after

## 4. Runtime Resolution

- [ ] 4.1 Add compound resolution loop in `packages/system/src/runtime/index.ts` — iterate `config.compounds`, check ALL condition entries against current variant prop values, push matching classNames
- [ ] 4.2 Ensure compound classes are added AFTER variant classes and BEFORE state classes in the className array

## 5. Verification

- [ ] 5.1 Add canary test fixture with `.compound()` — component with 2 variant axes and 2 compound overrides
- [ ] 5.2 Update canary snapshot — verify compound CSS in `@layer compounds`, compound config in createComponent output
- [ ] 5.3 Run `bun run verify` — TS builds, tests, type checks pass
- [ ] 5.4 Run `bun run verify:showcase` — showcase builds (no compounds used yet, but layer declaration change must not break existing CSS)
- [ ] 5.5 Add a compound to a showcase component (e.g., StratumRow or a new Button variant) to verify end-to-end in dev
