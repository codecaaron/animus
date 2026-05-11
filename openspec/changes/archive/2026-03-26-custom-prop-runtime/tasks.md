## 1. Canary Fixture

- [x] 1.1 Create `packages/extract/tests/fixtures/custom-props.tsx` — component using `.props()` with: a prop with `transform: 'size'`, a prop with inline scale, a prop with theme scale ref. Include static and dynamic JSX usage of each.
- [x] 1.2 Wire fixture into `serialize-config.ts` if needed (custom prop transforms must be discoverable)

## 2. JSX Scanner — Custom Prop Dynamic Detection

- [x] 2.1 In `jsx_scanner.rs`, ensure `scan_jsx()` (used for custom prop scanning) produces `DynamicPropUsage` entries for custom props with dynamic values. Currently only `scan_jsx_usage()` tracks dynamic usage — verify custom prop path does the same.
- [x] 2.2 Return per-component custom dynamic usages from the scanner to the project analyzer (custom prop usages are already scoped by component binding via `global_custom_props` map)
- [x] 2.3 Add Rust unit tests for custom prop dynamic detection (identifier, conditional, static-only — 3 cases)

## 3. Project Analyzer — Per-Component Custom Prop Metadata

- [x] 3.1 After Phase 5b scanning, build per-component custom dynamic prop metadata: for each component with `custom_prop_configs`, intersect with detected custom dynamic usages to produce per-component `DynamicPropMeta` entries
- [x] 3.2 Build per-component custom prop class maps from `custom_output.class_map` — partition the global custom class map back into per-component maps using each component's custom prop config keys
- [x] 3.3 Store per-component custom metadata (class map + dynamic config) alongside `ComponentReplacement` — add `custom_prop_class_map` and `custom_dynamic_config` fields
- [x] 3.4 Handle inline scales in `DynamicPropMeta` — when `PropConfig.scale` is a `Value::Object` (inline map), extract key→value entries directly instead of theme prefix lookup

## 4. CSS Generator — Custom Prop Slot Entries

- [x] 4.1 Create `build_custom_variable_slot_entries()` in `css_generator.rs` — same pattern as `build_variable_slot_entries()` but takes per-component custom `DynamicPropMeta` with component-scoped slot class names (`animus-dyn-{hash8}-{prop}`)
- [x] 4.2 Pass custom slot entries to `generate_custom_prop_css()` via new `slot_entries` parameter — reuses `generate_utility_css_impl()` which already handles cascade ordering
- [x] 4.3 Wire custom slot entry building into `project_analyzer.rs` — build entries per-component, aggregate, and pass to `generate_custom_prop_css()`
- [x] 4.4 Add Rust unit test: custom prop slot class with cascade ordering (shorthand before longhand)

## 5. Transform Emitter — Per-Component Custom Prop Config

- [x] 5.1 Add `custom_prop_class_map: Option<HashMap<String, HashMap<String, String>>>` to `ComponentReplacement`
- [x] 5.2 Add `custom_dynamic_config: Option<HashMap<String, DynamicPropMeta>>` to `ComponentReplacement`
- [x] 5.3 In `build_runtime_config()`, emit `customPropMap` field when `custom_prop_class_map` is present — inline the map as JSON in the config object
- [x] 5.4 In `build_runtime_config()`, emit `customDynamicConfig` field when `custom_dynamic_config` is present — include `varName`, `slotClass`, `property`, `properties`, `transformName`, `scaleValues`. Use direct `transforms.{name}` reference for transform binding.
- [x] 5.5 In `apply_replacements()`, detect when any replacement references `transforms.` in custom dynamic config and ensure `transforms` import is included (may already be present from system dynamic props)
- [x] 5.6 Add Rust unit tests: replacement with custom prop map only, replacement with custom dynamic config + transform reference

## 6. Vite Plugin — Custom Transform Discovery

- [x] 6.1 In `runAnalysis()`, iterate manifest components' custom prop configs to discover transform names referenced by custom dynamic props. Include these in the `transforms` serialization set alongside system prop transforms.
- [x] 6.2 Verify `transforms` virtual module export includes custom-prop-only transforms (transform used by custom prop but not by any system prop)

## 7. Runtime — Custom Prop Resolution

- [x] 7.1 In `createComponent` (`packages/system/src/runtime/index.ts`), add `customPropMap` and `customDynamicConfig` to the `ComponentConfig` interface
- [x] 7.2 Extend prop resolution: check `customPropMap[propName][valueKey]` before `systemPropMap[propName][valueKey]`
- [x] 7.3 Extend dynamic fallback: check `customDynamicConfig[propName]` before `dynamicPropConfig[propName]` for CSS variable slot resolution
- [x] 7.4 Merge custom dynamic CSS variables into the same memoized `useRef` style object as system dynamic variables
- [x] 7.5 Handle responsive custom dynamic props: per-breakpoint CSS variables (same pattern as system props)

## 8. Canary Tests

- [x] 8.1 Add canary test: custom prop CSS appears in `@layer custom` with correct utility classes
- [x] 8.2 Add canary test: custom dynamic prop slot class appears in `@layer custom` with component-scoped class name and cascade ordering
- [x] 8.3 Add canary test: transformed JS contains `customPropMap` in createComponent config
- [x] 8.4 Add canary test: transformed JS contains `customDynamicConfig` with `transforms.` reference for custom prop with transform

## 9. Verification Checkpoint

- [x] 9.1 Run `bun run verify:full` — full pipeline including showcase build
- [x] 9.2 Verify bundle size delta is proportional only to components with `.props()` (no global overhead for components without custom props)
