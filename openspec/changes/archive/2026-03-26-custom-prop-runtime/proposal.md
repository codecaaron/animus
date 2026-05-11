## Why

`.props()` custom prop definitions are parsed by the Rust crate and CSS is generated into `@layer custom`, but the class maps never reach the runtime — so custom prop values are stripped from the DOM (correct) but no utility class is applied (broken). Dynamic custom props have no CSS variable slots, no transform bindings, and no scale resolution. This is the last gap between `.props()` being syntactically accepted and actually producing visible CSS at runtime.

## What Changes

- **Per-component `customPropMap`** inlined in the `createComponent` config object. Maps custom prop names → value → className, same structure as the shared `systemPropMap` but scoped to a single component.
- **Per-component `customDynamicConfig`** for dynamic custom prop values. CSS variable slots in `@layer custom`, scale value pre-resolution (from theme refs or inline scales), transform references bound directly from the shared `transforms` export.
- **Cascade-ordered slot entries in `@layer custom`** — shorthand-before-longhand ordering applied to custom prop dynamic slot CSS, matching the `@layer system` strategy.
- **Canary test fixture** using `.props()` with a transform and both static + dynamic usage to verify the full pipeline end-to-end.
- Runtime `createComponent` extended to check component-local `customPropMap` when `systemPropMap` has no match, and resolve dynamic custom props via per-component config.

## Capabilities

### New Capabilities

_(none — this extends existing capabilities)_

### Modified Capabilities

- `extraction-runtime-shim`: `createComponent` config gains `customPropMap` and `customDynamicConfig` fields. Runtime resolution checks component-local custom maps after shared system map. Dynamic custom prop CSS variable application with per-component memoization.
- `utility-css-generation`: `@layer custom` gains dynamic slot entries via `build_variable_slot_entries()`. Cascade ordering (shorthand-before-longhand) applied to custom prop slot CSS. `generate_custom_prop_css()` accepts slot entries parameter.
- `jsx-system-prop-scanner`: Scanner must detect dynamic usage of custom props and produce per-component `DynamicPropUsage` entries. Custom prop dynamic detection scoped to the defining component's binding.
- `vite-extraction-plugin`: Custom prop transforms included in the shared `transforms` virtual module export. Per-component custom prop metadata (class maps, dynamic config) serialized into manifest for transform_file consumption.
- `dynamic-prop-fallback`: Extended to cover custom props with per-component metadata. `DynamicPropMeta` built from custom `PropConfig` (including inline scales). Variable naming scoped per-component to avoid collision with system props.

## Impact

- **Rust crate**: `project_analyzer.rs` (per-component custom prop metadata), `css_generator.rs` (custom slot entries), `transform_emitter.rs` (inline custom prop maps in replacement), `jsx_scanner.rs` (custom prop dynamic detection)
- **Runtime**: `packages/system/src/runtime/index.ts` — custom prop resolution path in createComponent
- **Vite plugin**: `packages/vite-plugin/src/index.ts` — custom transform serialization
- **Tests**: New canary fixture with `.props()`, new canary assertions for custom prop CSS + replacement code
- **Bundle**: Per-component custom prop maps add bytes proportional to custom prop count (typically <100B per component with custom props). No impact on components without `.props()`.
