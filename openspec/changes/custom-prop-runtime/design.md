## Context

`.props()` defines per-component custom props with CSS property mappings, optional scales, and optional transforms. The Rust extraction pipeline already parses `.props()`, scans JSX for custom prop usage, and generates utility CSS in `@layer custom`. However, the class maps from that CSS generation never reach the runtime — `createComponent` only knows about the shared `systemPropMap`. Dynamic custom props have no CSS variable slots, no scale resolution, and no transform bindings.

The `dynamic-prop-fallback` change (shipped) solved this for system props by building shared `dynamicPropConfig` metadata in the manifest. Custom props can't use the same shared approach because they're per-component — two components can define `size` with different CSS property targets.

## Goals / Non-Goals

**Goals:**
- Static custom prop values produce visible CSS at runtime via per-component class maps
- Dynamic custom prop values get CSS variable slots with scale resolution and transform bindings
- `@layer custom` has shorthand-before-longhand cascade ordering for slot entries
- Custom prop transforms use the shared transform registry (same functions, per-component binding)
- Canary test fixture validates the full `.props()` pipeline end-to-end

**Non-Goals:**
- Custom prop groups (grouping custom props like system prop groups) — future
- Cross-component custom prop deduplication — custom props stay per-component by design
- Custom prop type system changes — types already work via `Scale<CP[K], T>`
- Showcase components using `.props()` — can be added separately

## Decisions

### 1. Inline per-component maps, not virtual module

Custom prop class maps and dynamic config are inlined in the `createComponent` config object (3rd param) rather than added to the virtual module.

**Why:** Custom props are per-component. The virtual module pattern works for shared data (one `systemPropMap` for all components). Per-component data belongs in the per-component config. Inlining avoids virtual module complexity and makes each component self-contained.

**Alternative:** Per-component virtual module exports (`virtual:animus/custom-props/Card`). Rejected: too many virtual modules, complex HMR, unnecessary indirection.

### 2. Config object gains `customPropMap` and `customDynamicConfig`

```js
createComponent('div', 'animus-Card-abc', {
  systemPropNames: [...],
  customPropMap: { size: { sm: 'animus-u-xyz', lg: 'animus-u-def' } },
  customDynamicConfig: {
    size: {
      varName: '--animus-size',
      slotClass: 'animus-dyn-abc12-size',
      property: 'flex-basis',
      transformName: 'size',
      scaleValues: { xs: '10rem', sm: '15rem' }
    }
  }
}, systemPropMap)
```

**Why:** Same structure as the shared system prop counterparts but scoped to one component. Runtime code can share resolution logic — just different lookup sources.

### 3. Slot class scoped per-component, CSS variable not

Slot class names: `animus-dyn-{classHash8}-{prop}` (e.g., `animus-dyn-abc12345-size`)
CSS variable names: `--animus-{prop}` (e.g., `--animus-size`)

**Why:** CSS variables are applied via inline `style` on the element — no cross-component collision possible since each component instance is a different DOM node. But slot classes live in the global `@layer custom` CSS sheet — two components defining `size` with different CSS property targets would produce conflicting declarations under the same class name without scoping. The class hash (first 8 chars of the component's class_name) ensures uniqueness.

**Alternative:** Scope both. Rejected: CSS variable scoping (`--animus-abc12-size`) hurts debuggability in DevTools with no real benefit since variables are element-scoped.

### 4. Transform references bound directly in emitted code

```js
import { transforms } from 'virtual:animus/system-props';
// ...
createComponent('div', 'animus-Card-abc', {
  customDynamicConfig: {
    size: { ..., transform: transforms.size }
  }
})
```

**Why:** The `transforms` export is already imported when system props have dynamic usage. Custom prop transforms reference the same shared functions by name. No binding loop needed — direct property access at module evaluation time. If transforms import isn't already present (component has custom dynamic props but no system dynamic props), the emitter adds it.

**Alternative:** Per-component binding loop like system props. Rejected: direct reference is simpler and produces less code.

### 5. `generate_custom_prop_css()` gains `slot_entries` parameter

Same pattern as `generate_utility_css()` — the existing `generate_utility_css_impl()` handles interleaved static + dynamic entries with cascade ordering. Custom prop slot entries are built by a new `build_custom_variable_slot_entries()` that operates on per-component `PropConfigMap` + dynamic usage data.

**Why:** Reuses the proven single-sorted-stream architecture. `@layer custom` gets the same cascade-correct interleaving as `@layer system`.

### 6. Per-component dynamic metadata built in project_analyzer

After Phase 5b JSX scanning, the analyzer builds per-component custom dynamic prop metadata by intersecting each component's `custom_prop_configs` with the dynamic usage detected for that component's custom props. This is stored alongside the component's replacement data and passed to the emitter.

**Why:** System prop dynamic metadata is global (one `dynamic_props` on the manifest). Custom prop dynamic metadata must be per-component. Building it in the analyzer after scanning (same timing as system prop metadata) keeps the pipeline consistent.

### 7. Canary fixture: `custom-props.tsx`

New fixture component using `.props()` with:
- A prop with a transform (`size` transform on a sizing prop)
- A prop with an inline scale
- A prop with a theme scale ref
- Static and dynamic usage in JSX

This tests: parsing → CSS generation → class map → replacement emission → dynamic config.

## Risks / Trade-offs

- **[Per-component bytes]** Each component with `.props()` inlines its custom prop map in the JS output. Typically <100B per component — negligible vs. the component's other config. → Mitigation: only emitted for components that actually use `.props()`.
- **[Slot class hash collisions]** Using 8 chars of class hash for slot class scoping. Collision probability is ~1 in 4 billion for any two components. → Mitigation: if collision occurs, both components' slot CSS would be in the same `@layer custom` block with different declarations — browser applies last one. Extremely unlikely and would manifest as a visible bug caught in development.
- **[Custom + system prop name overlap]** A component could use `.groups({ space: true }).props({ p: { property: 'something' } })` — defining `p` as both a system prop and a custom prop. → Mitigation: custom prop takes precedence (checked in `customPropMap` first, then `systemPropMap`). The emitter should warn on overlap.
