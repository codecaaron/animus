## 1. TypeScript Builder Chain

- [x] 1.1 Add `CompoundEntry` type to `packages/system/src/types/config.ts` — `{ condition: Record<string, string>, styles: ThemedCSSProps<any, any> }`
- [x] 1.2 Add `compounds` instance array to `AnimusWithVariants` class in `Animus.ts`
- [x] 1.3 Add `.compound(condition, styles)` method on `AnimusWithVariants` — pushes to array, returns `this`. Condition typed as `{ [K in keyof Variants]?: keyof Variants[K]['variants'] }`
- [x] 1.4 Update `_buildComponentConfig()` on `AnimusWithAll` to include `compounds` array in returned config when non-empty
- [x] 1.5 Add type regression tests in `types.test-d.tsx` — compound condition keys constrained to variant names, values constrained to variant options, invalid keys/values rejected via `@ts-expect-error`

## 2. Cascade Layer Update

- [x] 2.1 Update layer declaration string in `packages/vite-plugin/src/index.ts` — add `compounds` between `variants` and `states`
- [x] 2.2 Update layer declaration in Rust `css_generator.rs` if the layer string is generated there

## 3. Rust Extraction Pipeline

- [x] 3.1 Add `"compound"` to `CHAIN_METHODS` in `chain_walker.rs`
- [x] 3.2 Parse `.compound()` calls — extract condition object (first arg) and styles object (second arg) as two spans per call
- [x] 3.3 Add `compounds: Vec<CompoundDescriptor>` to `ChainDescriptor` struct where `CompoundDescriptor` has `condition: HashMap<String, String>` and `styles` span
- [x] 3.4 Evaluate compound style objects in `style_evaluator.rs` using same pipeline as variant styles
- [x] 3.5 Generate `@layer compounds { }` block in `css_generator.rs` with class naming `animus-{Name}-{hash}--compound-{index}`
- [x] 3.6 Add `compounds` field to `ComponentReplacement` in `transform_emitter.rs` — array of `{ conditions, className }`
- [x] 3.7 Emit `compounds` in `createComponent` config when non-empty
- [x] 3.8 Handle compound inheritance in `chain_merger.rs` — extension inherits parent compounds, own compounds appended after

## 4. Runtime Resolution

- [x] 4.1 Add compound resolution loop in `packages/system/src/runtime/index.ts` — iterate `config.compounds`, check ALL condition entries against current variant prop values, push matching classNames
- [x] 4.2 Ensure compound classes are added AFTER variant classes and BEFORE state classes in the className array

## 5. Verification

- [x] 5.1 Add canary test fixture with `.compound()` — component with 2 variant axes and 2 compound overrides
- [x] 5.2 Update canary snapshot — verify compound CSS in `@layer compounds`, compound config in createComponent output
- [x] 5.3 Run `bun run verify` — TS builds, tests, type checks pass
- [x] 5.4 Run `bun run verify:showcase` — showcase builds (no compounds used yet, but layer declaration change must not break existing CSS)
- [ ] 5.5 Add a compound to a showcase component to verify end-to-end in dev (deferred — requires dev server)

## 6. Compound Condition Arrays

- [x] 6.1 Widen `.compound()` condition type in `Animus.ts` — accept `keyof Variants[K]['variants'] | ReadonlyArray<keyof Variants[K]['variants']>` per condition key
- [x] 6.2 Same change in `AnimusExtended.ts`
- [x] 6.3 Widen `CompoundConfig.conditions` in `runtime/index.ts` to `Record<string, string | string[]>`
- [x] 6.4 Update runtime compound matching — `Array.isArray(expected) ? expected.includes(current) : current !== expected`
- [x] 6.5 Update `CompoundConfig.conditions` in `transform_emitter.rs` — `HashMap<String, serde_json::Value>` for string-or-array serialization
- [x] 6.6 Update condition parsing in `lib.rs` — handle `Value::Array` in addition to `Value::String`
- [x] 6.7 Add type regression tests in `types.test-d.tsx` — array conditions compile, single values still work
- [x] 6.8 Add canary test fixture with array conditions + assertions
- [x] 6.9 Run `bun run verify` — all tests pass
