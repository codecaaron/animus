## Context

The extraction pipeline currently handles only statically-resolvable prop values. When a system or custom prop receives a dynamic value (variable, ternary, function call), `eval_jsx_attribute_value()` in `jsx_scanner.rs` returns `None` — the prop silently produces no utility class, no CSS is set. This is the single largest gap in the compiler.

The inline scale fix shipped this session (PropConfig.scale accepts `Value` — string refs, inline maps, arrays, createScale phantoms). That was piece 1 of 5. This design covers pieces 2–5: dynamic detection, CSS variable slot generation, runtime fallback, and transform shipping.

**Current resolution flow (static only):**
```
JSX scan → eval_jsx_attribute_value() → Some(Value) | None
                                          ↓              ↓
                                    UtilityInput     silently dropped
                                          ↓
                                    resolve_styles() → CSS class
                                          ↓
                                    class_map[prop][serialized_value] = className
                                          ↓
                                    createComponent: systemPropMap[prop][key] → className
```

**After dynamic-prop-fallback:**
```
JSX scan → eval_jsx_attribute_value() → Static(Value) | Dynamic(prop_name)
                                           ↓                  ↓
                                     UtilityInput      DynamicPropUsage
                                           ↓                  ↓
                                     CSS class          CSS variable slot class
                                           ↓                  ↓
                                     class_map          dynamicPropConfig
                                           ↓                  ↓
                              createComponent: try class_map → fallback → CSS variable
```

## Goals / Non-Goals

**Goals:**
- Every prop value a user can legally write produces visible CSS — static values get zero-recalc utility classes, dynamic values get CSS-variable-backed fallback with one style recalc
- Zero cost for static-only usage — no variable slot classes, no transform shipping, no runtime fallback logic ships if no dynamic values are detected
- Transforms apply identically at build time and runtime — same functions, same behavior
- The type system remains unchanged — the compiler catches up to what the types already allow

**Non-Goals:**
- Runtime scale resolution — dynamic values are NOT resolved through theme scales at runtime. The user's dynamic value IS the CSS value (with transform applied). This is documented behavior: `p={8}` statically resolves through the `space` scale to `0.5rem`, but `p={variable}` where `variable = 8` produces `padding: 8px` (with unit fallback). If you need scale-resolved values dynamically, use the token directly: `p={theme.space[8]}`.
- Semi-static optimization — `p={condition ? 4 : 8}` where both branches are in the static map could theoretically extract both classes and toggle. This is a future optimization, not v1.
- Spread scanning — `{...props}` remains ignored. Dynamic detection applies to explicitly written prop attributes only.
- Custom prop runtime resolution — custom props are per-component and not in the shared map. Dynamic fallback for custom props follows the same architecture but requires per-component `dynamicPropConfig` in the replacement call. This is scoped to v1 but only for system/group props; custom prop extension is future work.

## Decisions

### 1. Scanner returns enum, not Option

**Decision:** Change `eval_jsx_attribute_value()` to return a three-state result: `Static(Value)`, `Dynamic`, or `Skip`.

**Alternative considered:** Adding a parallel `Vec<DynamicPropUsage>` collection alongside `Vec<SystemPropUsage>`. Rejected because the scanner's existing walk already visits every prop attribute — splitting into two collections adds no clarity and makes the dedup logic harder to maintain.

**Implementation:**
```rust
enum PropValueResult {
    Static(Value),   // Literal/object — generate utility class
    Dynamic,         // Variable/expression — generate CSS variable slot
    Skip,            // Spread, non-prop attribute
}
```

The `_ => None` catch-all at line 441 becomes `_ => Dynamic`. Existing `None` returns for spreads and empty expressions become `Skip`.

### 2. Dynamic prop metadata flows through manifest

**Decision:** The manifest gains a `dynamic_props` field: `HashMap<String, DynamicPropMeta>` mapping prop names to their CSS variable config. Only props with at least one detected dynamic usage appear.

**Alternative considered:** Embedding dynamic config directly in each `ComponentReplacement`. Rejected because dynamic prop config is per-prop (not per-component) — a prop is dynamic if ANY component uses it dynamically. Same deduplication principle as `systemPropMap`.

**DynamicPropMeta structure:**
```rust
struct DynamicPropMeta {
    var_name: String,           // "--animus-p"
    slot_class: String,         // "animus-dyn-p"
    property: String,           // "padding" (from PropConfig)
    properties: Vec<String>,    // multi-property props (paddingLeft, paddingRight)
    transform_name: Option<String>,  // "size" (if prop has transform)
}
```

### 3. CSS variable naming convention

**Decision:** `--animus-{prop-name-kebab}` for base, `--animus-{prop-name-kebab}-{breakpoint}` for responsive. Prop names are converted from camelCase to kebab-case for CSS convention compliance.

**Examples:**
- `--animus-p` (base padding)
- `--animus-p-sm` (padding at sm breakpoint)
- `--animus-mt-lg` (margin-top at lg breakpoint)
- `--animus-border-radius` (from `borderRadius` prop)
- `--animus-border-radius-sm` (responsive breakpoint)

**Rationale:** Short, predictable, debuggable. The `animus-` prefix prevents collision with user CSS variables. Prop name (not CSS property name) is used because multiple props can map to the same CSS property (e.g., `p` and `px` both affect padding). Kebab-case conversion follows CSS custom property conventions.

### 4. Variable slot class naming and generation

**Decision:** One class per dynamic prop, named `animus-dyn-{prop_name}`. This class reads from the CSS variable for each CSS property the prop maps to.

**Generated CSS for a prop `p` (property: padding) with 3 breakpoints:**
```css
@layer system {
  .animus-dyn-p {
    padding: var(--animus-p);
  }
  @media (min-width: 640px) {
    .animus-dyn-p {
      padding: var(--animus-p-sm, var(--animus-p));
    }
  }
  @media (min-width: 768px) {
    .animus-dyn-p {
      padding: var(--animus-p-md, var(--animus-p));
    }
  }
}
```

**Multi-property props** (e.g., `px` → paddingLeft + paddingRight):
```css
.animus-dyn-px {
  padding-left: var(--animus-px);
  padding-right: var(--animus-px);
}
```

**Layer placement and cascade ordering:** Slot classes are merged into the same `@layer system` emission stream as static utility classes via `build_variable_slot_entries()`. All rules — static and dynamic — are sorted by CSS property cascade key (shorthands first, longhands last), mirroring the ordering from `packages/core/src/properties/orderPropNames.ts`. This ensures longhands always override shorthands within the same layer. One `@layer system {}` block, one sort, interleaved.

**Alternative considered:** One class per prop per breakpoint. Rejected — the CSS `var()` fallback chain (`var(--animus-p-sm, var(--animus-p))`) handles missing breakpoints gracefully in a single class. Fewer classes = smaller CSS, simpler runtime.

**Alternative considered (and shipped initially):** Two separate CSS blocks — slot classes prepended, utility classes appended. Rejected during implementation because shorthand slot classes could override longhand utility classes due to source order. Merged into single sorted stream.

### 5. Runtime fallback in createComponent

**Decision:** When `systemPropMap[prop][key]` returns no class, check if `dynamicPropConfig` has an entry for that prop. If yes: add the variable slot class and set CSS variable(s) on inline style.

**New parameter:** `createComponent` gains an optional 5th parameter `dynamicPropConfig`:
```typescript
type DynamicPropConfig = Record<string, {
  varName: string;      // "--animus-p"
  slotClass: string;    // "animus-dyn-p"
  transform?: (value: string | number) => string | number;
}>;
```

**Resolution logic:**
```
for each system prop:
  1. If value is null/undefined → skip entirely (no class, no variable)
  2. Try static map lookup: systemPropMap[prop][serializeValueKey(value)]
  3. If match → push static class (existing behavior, zero overhead)
  4. If no match AND dynamicPropConfig[prop] exists:
     a. Push slotClass to classes array
     b. Resolve value via resolveValue():
        i.   Check scaleValues[String(value)] → if found, use pre-resolved CSS value
        ii.  Apply transform if configured (to scale-resolved or raw value)
        iii. Apply unit fallback (applyUnitFallback) if no scale match
     c. If value is responsive object: resolve each breakpoint value, set per-breakpoint CSS variables
     d. If value is primitive: resolve, set base CSS variable
     e. Merge into memoized style object
```

**Memoization:** The inline style object for CSS variables is cached via `useRef`. A new object is only allocated when the serialized dynamic prop values change between renders. This prevents React from scheduling unnecessary DOM mutations on re-renders with stable values.

**Unit fallback:** The runtime applies the same unit fallback logic as the static path — unitless numeric values on properties that expect length units receive `px`. Properties in the unitless set (`lineHeight`, `opacity`, `zIndex`, etc.) are skipped.

**Alternative considered:** Always applying inline styles without the slot class. Rejected — the slot class provides the CSS property mapping via `var()`. Without it, we'd need to know the CSS property name at runtime (possible but redundant with what's already in CSS).

### 6. Transform shipping via virtual module

**Decision:** The virtual module `virtual:animus/system-props` gains separate `dynamicPropConfig` and `transforms` exports. Transform functions are kept as a separate export for independent HMR invalidation. Binding happens at component definition time (module load), not per render.

**Rationale:** Transform functions already exist as JS in `ds.serialize().transforms`. They're loaded at `buildStart`. The virtual module already serves data — adding code exports is natural. Lazy inclusion means only transforms with dynamic prop usage ship. Keeping `transforms` separate from `dynamicPropConfig` means changes to dynamic prop detection don't invalidate the (larger, stable) `systemPropMap` export unnecessarily.

**Virtual module output:**
```javascript
export const systemPropMap = { ... };
export const systemPropGroups = { ... };
export const dynamicPropConfig = { p: { varName: '--animus-p', slotClass: 'animus-dyn-p', transformName: null }, borderRadius: { varName: '--animus-border-radius', slotClass: 'animus-dyn-border-radius', transformName: 'size' } };
export const transforms = { size: function(v) { ... } };
```

**Transform binding at definition time:** The generated replacement code binds transforms once at module load, not per render:
```javascript
import { systemPropMap, dynamicPropConfig, transforms } from 'virtual:animus/system-props';
// Bind transforms at definition time (runs once at module load):
for (const [k, v] of Object.entries(dynamicPropConfig)) {
  if (v.transformName) v.transform = transforms[v.transformName];
}
createComponent('div', 'animus-Box-abc', config, systemPropMap, dynamicPropConfig);
```

This keeps the one-time binding cost at module load (O(N dynamic props)) and the per-render cost at zero for transform lookup.

### 7. Responsive dynamic value handling

**Decision:** When a dynamic prop receives a responsive object `{ _: x, sm: y, md: z }`, the runtime sets per-breakpoint CSS variables:
```
style['--animus-p'] = transform(x)       // base
style['--animus-p-sm'] = transform(y)    // sm
style['--animus-p-md'] = transform(z)    // md
```

The CSS fallback chains handle partial objects — if only `_` and `md` are set, the `sm` breakpoint falls back to `var(--animus-p)` (the base value).

**Alternative considered:** Flattening responsive objects to a single serialized key and looking up in the static map first. This is already done — `serializeValueKey()` produces `"_:x|sm:y"` and the map lookup happens first. The dynamic fallback only triggers when the serialized key has no match.

### 8. Import injection pattern

**Decision:** The transform emitter injects `dynamicPropConfig` alongside existing imports:
```javascript
import { createComponent } from '@animus-ui/system';
import { systemPropMap, systemPropGroups, dynamicPropConfig } from 'virtual:animus/system-props';
```

The 5th argument is only emitted for components that use props with detected dynamic usage.

**Conditional logic:**
- Component uses group props with dynamic usage → import `dynamicPropConfig`, pass as 5th arg
- Component uses only static group props → no change to existing behavior
- Component uses no group props → no system prop imports at all

## Risks / Trade-offs

### [Risk: Scale resolution gap] → Document behavior difference
Dynamic values do NOT resolve through theme scales. `p={8}` statically gives `padding: 0.5rem` (via `space` scale), but `p={variable}` where `variable = 8` gives `padding: 8px` (unit fallback). **Mitigation:** Document clearly. Transforms still apply (e.g., `size` transform converts units). Future: optional per-prop scale shipping for props that need runtime resolution.

### [Risk: Transform function serialization] → Functions serialize as source text
The virtual module emits transform functions as source text. If transforms close over external state (imports, config), serialization breaks. **Mitigation:** Transforms in Animus are already context-free pure functions — they receive a value and return a CSS value. The existing `ds.serialize().transforms` registry confirms this. Validate during virtual module generation that each transform is serializable.

### [Risk: CSS variable collision] → Namespaced variable names
Two different components using the same system prop (e.g., both use `p`) share the same CSS variable (`--animus-p`). If both are rendered with different dynamic values, the last render wins. **Mitigation:** CSS variables are set via inline `style` on the element, so they're scoped to that element's subtree. No collision occurs because each element sets its own inline style.

### [Risk: Bundle size increase] → Lazy everything
Variable slot CSS adds ~4 rules per dynamic prop per breakpoint count. Transform functions add bytes per shipped transform. **Mitigation:** Both are lazy — only generated/shipped for props with detected dynamic usage. If a project uses only static values, bundle impact is zero.

### [Risk: Style recalc performance] → One recalc per prop change, bounded
Setting a CSS variable via inline style triggers a style recalculation. For responsive objects, multiple CSS variables are set in one render. **Mitigation:** This is standard CSS variable behavior — same performance as any CSS-in-JS library setting inline styles. The user opted into dynamism. Static props remain zero-recalc.

### [Risk: Stale dynamic detection on HMR] → Geological reset handles it
If a prop changes from dynamic to static usage (or vice versa) during development, the variable slot classes need to be regenerated. **Mitigation:** The existing geological reset path re-runs full analysis when system files change. For app file changes, the incremental path re-scans JSX — dynamic detection runs on every scan. The virtual module is invalidated when dynamic prop metadata changes.

## Resolved Questions

1. **Transform binding: post-bind at definition time.** Transforms are a separate export. Binding happens once at module load via a for-of loop in the generated replacement code. Zero per-render cost. Independent HMR invalidation.

2. **Custom prop dynamic fallback: deferred to v1.1.** v1 handles system/group props only. Custom props are per-component and less common in application code. The architecture supports adding custom prop fallback later without changes to the core dynamic prop infrastructure.

3. **Scale resolution: shipped via pre-resolved value maps.** Each dynamic prop's `DynamicPropMeta` includes `scale_values: HashMap<String, String>` — all scale entries pre-resolved at build time (e.g., `{ "1": "1px solid" }` for borders). The runtime resolves through this map before falling back to raw value + unit fallback. This was added during implementation after live testing showed that `borderBottom={1}` produced `1px` instead of the scale-resolved `1px solid`.

4. **Variable naming: kebab-case.** Prop names converted from camelCase to kebab-case for CSS convention compliance. `borderRadius` → `--animus-border-radius`.

5. **SSR compatibility: works by design.** CSS variables are set via the `style` attribute in SSR-rendered HTML. The browser has both the slot class (from `<head>` stylesheet) and the inline style variable on first paint. `var(--animus-p)` resolves immediately. Zero layout flash.

6. **Memoization: useRef-based cache.** Dynamic style object is cached via `useRef` with a serialized key comparison. New object only allocated when values change. Prevents unnecessary React DOM mutations.
