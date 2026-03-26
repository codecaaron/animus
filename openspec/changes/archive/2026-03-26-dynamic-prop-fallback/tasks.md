## 1. Dynamic Value Detection in JSX Scanner

- [x] 1.1 Add `DynamicPropUsage` struct to `jsx_scanner.rs` with `prop_name: String` and `binding: String` fields
- [x] 1.2 Change `eval_jsx_attribute_value()` return type from `Option<Value>` to a three-state enum `PropValueResult { Static(Value), Dynamic, Skip }` — map existing `None` returns to either `Dynamic` or `Skip` appropriately
- [x] 1.3 Update `collect_from_jsx_opening()` to handle `PropValueResult::Dynamic` — collect dynamic prop usage with dedup by prop_name (not by value)
- [x] 1.4 Add `dynamic_prop_usages: Vec<DynamicPropUsage>` to `UsageScanResult` and thread through `scan_jsx_usage()`
- [x] 1.5 Add unit tests: identifier, call expression, conditional, member expression, template literal with expression all produce `Dynamic`; string/number/object literals still produce `Static`

## 2. Dynamic Prop Metadata in Manifest

- [x] 2.1 Add `DynamicPropMeta` struct to `project_analyzer.rs` with fields: `var_name`, `slot_class`, `property`, `properties`, `transform_name` — var_name and slot_class use camelCase→kebab-case conversion of prop names
- [x] 2.2 Add `dynamic_props: HashMap<String, DynamicPropMeta>` to `UniverseManifest`
- [x] 2.3 Aggregate dynamic prop usages across all files during Phase 5b — populate `dynamic_props` from PropConfig (property, properties, transform) and generate var_name/slot_class using kebab-case naming convention
- [x] 2.4 Serialize `dynamic_props` into the manifest JSON output
- [x] 2.5 Add `camel_to_kebab()` utility function for prop name conversion in CSS variable names

## 3. CSS Variable Slot Class Generation

- [x] 3.1 Add `generate_variable_slot_css()` function to `css_generator.rs` — accepts `dynamic_props` map and breakpoints, returns CSS string with variable slot classes
- [x] 3.2 Generate base rule: `.animus-dyn-{prop-kebab} { {property}: var(--animus-{prop-kebab}); }` for single-property props
- [x] 3.3 Generate multi-property rules: `.animus-dyn-{prop-kebab} { {prop1}: var(--animus-{prop-kebab}); {prop2}: var(--animus-{prop-kebab}); }` for multi-property props (e.g., `px`)
- [x] 3.4 Generate breakpoint fallback chains: `@media (min-width: X) { .animus-dyn-{prop-kebab} { {property}: var(--animus-{prop-kebab}-{bp}, var(--animus-{prop-kebab})); } }` for each breakpoint
- [x] 3.5 Place variable slot classes in `@layer system` — append to the existing system layer CSS output
- [x] 3.6 Add unit tests: single property, multi-property, breakpoint chains, camelCase→kebab conversion, empty dynamic_props produces no output

## 4. Transform Emitter Updates

- [x] 4.1 Update `generate_replacement()` in `transform_emitter.rs` to emit 5th argument `dynamicPropConfig` when the component uses props with dynamic usage
- [x] 4.2 Update `apply_replacements()` import injection to include `dynamicPropConfig` and `transforms` from virtual module when dynamic props are present — generate transform binding loop at module load time
- [x] 4.3 Thread `dynamic_props` metadata through `ComponentReplacement` — add `has_dynamic_props: bool` flag so the emitter knows whether to emit the 5th argument
- [x] 4.4 Add unit tests: replacement with dynamic props includes 5th arg + transform binding loop + imports, replacement without dynamic props unchanged

## 5. Runtime Dynamic Fallback in createComponent

- [x] 5.1 Add `DynamicPropConfig` type to `runtime/index.ts`: `Record<string, { varName: string; slotClass: string; transformName?: string; transform?: (value: string | number) => string | number }>`
- [x] 5.2 Add optional 5th parameter `dynamicPropConfig?: DynamicPropConfig` to `createComponent` signature
- [x] 5.3 Implement fallback logic: when `systemPropMap[prop][key]` returns no match AND `dynamicPropConfig[prop]` exists AND value is not null/undefined, push `slotClass` to classes and set CSS variable on inline style
- [x] 5.4 Implement responsive dynamic handling: for object values, set per-breakpoint CSS variables (`--animus-{prop-kebab}-{bp}`) with unit fallback applied to each breakpoint value
- [x] 5.5 Apply transform when configured: `dynamicPropConfig[prop].transform(value)` before setting CSS variable
- [x] 5.6 Apply unit fallback (`applyUnitFallback`) to dynamic values — unitless numeric values on length properties receive `px`
- [x] 5.7 Handle null/undefined values: skip entirely — neither slot class nor CSS variable applied
- [x] 5.8 Ensure static match takes precedence and excludes slot class: only fall back to dynamic when no class match exists in systemPropMap
- [x] 5.9 Implement `useRef`-based style memoization: cache the dynamic style object keyed by serialized dynamic prop values, only allocate new object when values change

## 6. Virtual Module Transform Shipping

- [x] 6.1 Extract `dynamic_props` from manifest in `runAnalysis()` and store as `storedDynamicPropsJson`
- [x] 6.2 Identify transforms used by dynamic props — intersect `dynamic_props[*].transform_name` with `transformRegistry`
- [x] 6.3 Serialize used transform functions to source text using `Function.prototype.toString()` with validation — emit as separate `transforms` export
- [x] 6.4 Extend `load()` hook for `virtual:animus/system-props` — emit `dynamicPropConfig` (with `transformName` strings, not bound functions) and `transforms` as separate exports when dynamic props exist
- [x] 6.5 Add HMR invalidation for dynamic prop changes — invalidate virtual module when `storedDynamicPropsJson` changes

## 7. Canary Tests and Verification

- [x] 7.1 Add showcase component with dynamic prop usage (e.g., `<Box p={computedValue} />`) as canary test fixture
- [x] 7.2 Assert canary: dynamic prop appears in manifest `dynamic_props` with correct var_name (kebab-case), slot_class, property
- [x] 7.3 Assert canary: CSS output contains variable slot class with breakpoint fallback chains using kebab-case variable names
- [x] 7.4 Assert canary: generated replacement includes `dynamicPropConfig` as 5th argument with transform binding loop
- [x] 7.5 Run `bun run verify:full` — all existing tests pass, showcase builds successfully with dynamic prop support

## 8. ⏸ Verification Checkpoint — Pause and Reorient

**STOP HERE after tasks 1–7 are complete.** Before considering this change done, assess the following questions together. The goal is to determine what additional testing, edge case coverage, or regression guards are needed given the actual implementation.

### Questions to consider:

**Regression surface:**
- Did any existing canary test assertions need updating beyond snapshot refreshes? If yes, what changed and why?
- Are there implicit assumptions in the existing runtime tests or type tests that the new 5th parameter breaks?
- Does the showcase bundle size change? If so, by how much and is it attributable to slot class CSS or virtual module growth?

**Edge case coverage gaps:**
- Same prop static in one file, dynamic in another — does the slot class appear in CSS AND the static classes remain?
- Dynamic value at runtime that matches a static class key — does static take precedence cleanly?
- Responsive object with mixed static/dynamic values (e.g., `{ _: variable, sm: 8 }`) — is the entire object treated as dynamic?
- Extension chain: parent component static-only, child component with dynamic usage — does child get the 5th argument?
- Component with NO system props — zero behavioral change? No `dynamicPropConfig` imported?
- Empty project (no dynamic usage at all) — is the output byte-identical to before this change?

**Testing strategy assessment:**
- What is the right home for runtime fallback tests? (Unit tests in system package? Integration via canary? Both?)
- Should we add a programmatic fixture that exercises the dynamic path end-to-end (source → Rust → manifest → replacement → runtime render)?
- Is the memoization testable without a React test harness? If not, what's the minimum viable test?
- Should type regression tests cover the new `DynamicPropConfig` type and the 5th parameter signature?

**Holistic correctness:**
- Walk through the full data flow for ONE dynamic prop: scanner → manifest → CSS → virtual module → transform emitter → createComponent → DOM output. Does every step produce exactly what the next step expects?
- Is `serializeValueKey` in TS still an exact mirror of `serialize_value_key` in Rust after this change?
- Does the unit fallback logic in the runtime match `applyUnitFallback` in the plugin? Should it be a shared utility?
