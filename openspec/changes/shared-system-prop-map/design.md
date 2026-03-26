## Context

Each extracted component currently receives its own `systemProps` class map embedded in the `createComponent()` config. The Rust extraction pipeline builds this per-component map by intersecting global utility classes with each component's active group props. At runtime, `createComponent` iterates the component's `systemPropNames`, serializes each prop value, and looks it up in the embedded map.

This works correctly but creates two architectural problems:
1. **JS duplication**: Components sharing the same groups embed overlapping maps (e.g., 20 components with `space: true` each carry `{ p: { "8": "animus-u-xxx", ... } }`).
2. **HMR blast radius**: When a utility class hash changes, every component file embedding that hash must be re-transformed by the Rust pipeline and hot-replaced.

The CSS utility classes themselves are already deduplicated globally in `@layer system`. Only the JS lookup tables are duplicated.

## Goals / Non-Goals

**Goals:**
- Centralize the `{ propName: { valueKey: className } }` map into a single shared module
- Reduce per-component `createComponent` config to just `systemPropNames` (string array)
- Enable single-point HMR invalidation for utility class changes
- Maintain runtime resolution speed (still just string key lookup)
- Keep the runtime package (`@animus-ui/runtime`) portable — no hard dependency on virtual modules

**Non-Goals:**
- MPA/code-split optimization of the shared map (future work — SPA-first)
- Changing how CSS utility classes are generated or deduplicated (unchanged)
- Changing the builder API or how `.groups()` / `.props()` are authored (unchanged)
- Per-component tree-shaking of individual prop entries from the shared map

## Decisions

### 1. Shared map as virtual module (`virtual:animus/system-props`)

The global system prop map is served as `virtual:animus/system-props`, a JavaScript module exporting a single named binding.

**Module shape:**
```js
export const systemPropMap = {
  p: { "2": "animus-u-aaa", "4": "animus-u-bbb", "8": "animus-u-ccc" },
  mt: { "4": "animus-u-ddd", "_:8|sm:16": "animus-u-eee" },
  color: { "primary": "animus-u-fff" },
  gap: { "3": "animus-u-ggg" },
  // ... all props from all groups + custom props
};
```

**Why virtual module over alternatives:**
- **vs. globalThis/window**: Virtual modules participate in Vite's module graph — HMR, import analysis, and bundling work automatically. globalThis requires manual invalidation signaling and breaks SSR.
- **vs. generated file on disk**: Virtual modules avoid filesystem writes, avoid git noise, and are cache-coherent with the Vite dev server.
- **vs. separate JSON file**: A JS module is directly importable with no parsing step. The bundler can inline or chunk it.

This follows the existing pattern — `virtual:animus/styles.css` already serves extracted CSS as a virtual module.

### 2. Pass map as parameter to `createComponent`, not module-level import in runtime

The transformed code imports the shared map and passes it to `createComponent` as a parameter:

```js
import { createComponent } from '@animus-ui/runtime';
import { systemPropMap } from 'virtual:animus/system-props';

const Box = createComponent('div', 'animus-Box-hash', {
  systemPropNames: ["p", "mt", "mx", "my"]
}, systemPropMap);
```

**Why parameter over module-level registration:**
- **No ordering issues**: A `registerSystemPropMap()` pattern requires the registration call to execute before any component renders. Import ordering in bundled code is fragile.
- **Runtime stays portable**: `@animus-ui/runtime` has no dependency on `virtual:animus/system-props`. It receives the map as data. This keeps the package testable and usable outside Vite.
- **No global mutable state**: Each `createComponent` call receives the map reference. No singleton. No race conditions.

**Why per-file import is fine:**
Vite deduplicates module imports — `import { systemPropMap } from 'virtual:animus/system-props'` in 30 files resolves to one module instance. The import statement is ~60 bytes per file; the map data exists once in memory.

### 3. Rust crate emits the shared map as a separate artifact

The `analyzeProject` NAPI function currently returns `{ manifest, css }`. It will gain a third field:

```rust
AnalysisResult {
    manifest: String,   // JSON — component replacements, per-component data
    css: String,        // Generated CSS for all layers
    system_prop_map: String,  // JSON — { propName: { valueKey: className } }
}
```

The Vite plugin converts this JSON into the virtual module's JS source:
```js
`export const systemPropMap = ${result.system_prop_map};`
```

**Why separate from manifest:**
- The manifest is consumed only by the plugin at build time. The system prop map must be served to the client. Different consumers, different lifecycle.
- The manifest already contains per-component `system_props` data that will be removed. The shared map replaces all of it with one aggregate structure.

### 4. Custom props (`.props()`) included in shared map

Custom props defined via `.props()` use the same resolution pattern as group props. Their entries are included in the shared `systemPropMap` alongside group prop entries. The CSS layer distinction (`@layer custom` vs `@layer system`) is handled by the CSS generator, not the JS map.

**Why not separate maps:**
- The runtime resolution logic is identical for both. Splitting would add branching with no benefit.
- A single map lookup is simpler and faster than checking two maps.

### 5. HMR: diff-based invalidation of the virtual module

During HMR, after re-extraction:
1. The plugin compares the new `system_prop_map` string against the cached version.
2. If different, the plugin invalidates `virtual:animus/system-props` via Vite's `server.moduleGraph`.
3. Vite propagates the invalidation to all importers (component files), triggering React re-renders.
4. Component source files are NOT re-transformed — their `createComponent` calls and `systemPropNames` haven't changed.

**Invalidation cases:**
- New JSX prop value found → new entry in map → invalidate
- Prop value removed (JSX edited) → entry removed → invalidate
- Theme scale change → utility hashes change → invalidate
- Component file edited but no system prop changes → no map invalidation

### 6. Transform emitter changes

**Before:**
```rust
ComponentReplacement {
    system_props: Some({ "p": { "8": "cls" }, ... }),
    system_prop_names: vec!["p", "mt", ...],
}
```
Emits: `createComponent('div', 'cls', { systemProps: {...}, systemPropNames: [...] })`

**After:**
```rust
ComponentReplacement {
    // system_props removed
    system_prop_names: vec!["p", "mt", ...],
}
```
Emits: `createComponent('div', 'cls', { systemPropNames: [...] }, systemPropMap)` with the import added to the file header.

The import `import { systemPropMap } from 'virtual:animus/system-props'` is added once per file that has any component with system props (same dedup logic as the existing `createComponent` import).

## Risks / Trade-offs

**[Shared map includes all values, not per-component subsets]** → In a typical SPA this is irrelevant — all components load anyway. For MPAs with route-splitting, the shared map might include entries for props only used on other routes. Mitigation: the map is small (string→string entries compress well), and per-route map splitting can be added later as an optimization.

**[Breaking change to `createComponent` signature]** → The 4th parameter is new. Existing tests and the runtime shim type need updating. Mitigation: this is an internal API consumed only by the extraction pipeline, not by end users. The change is mechanical.

**[Props not in the map produce no class]** → Same behavior as today — if a prop value wasn't found by the JSX scanner at build time, it has no utility class. The shared map doesn't change this constraint. A value used in component A can now resolve in component B if the same map entry exists, which is slightly MORE resilient than before.

**[Virtual module import adds ~60 bytes per transformed file]** → Negligible. Vite deduplicates the actual module. The import statement is smaller than the `systemProps` object it replaces.
