## Context

The Rust crate currently emits per-layer CSS strings via `CssSheets` (base, variants, compounds, states, system, custom). These are concatenated into a single CSS output for the virtual module. The manifest maps `component_id → ComponentDescriptor` but does not associate individual CSS fragments with component IDs — the CSS is only available as pre-concatenated layer strings.

The key architectural insight: component CSS uses hash-scoped selectors (`.animus-Card-abc123`) that can never cascade-conflict across components. Source order between components is meaningless within any layer. Only the system layer has shared selectors (`.animus-u-50e5d508`) with ordering dependencies. This means component CSS is inherently safe to split into independently-loadable chunks, while system CSS must remain global.

The showcase build already validates single-file delivery (5 JS chunks, 1 CSS file). Industry consensus (Tailwind, StyleX, Panda) is single-file delivery for static extraction. This proposal extends beyond that by exploiting hash scoping to enable what others cannot.

## Goals / Non-Goals

**Goals:**
- Per-component CSS addressability in the manifest (component_id → CSS fragments)
- Opt-in route-level CSS chunking in the Vite plugin
- Global chunk (declaration + variables + globals + system) always loads first
- Component CSS chunks load per-route, order-independent
- Shared component deduplication (components on multiple routes hoisted)
- Single-file mode remains default — zero behavioral change for existing consumers

**Non-Goals:**
- Per-component lazy loading (too granular, network overhead exceeds benefit)
- Dynamic CSS loading at runtime (no JS-driven stylesheet injection)
- Splitting the system layer (ordering-dependent, must stay global)
- Splitting theme variables (must precede all component CSS)
- Next.js/webpack support in this change (future — Vite only first)
- Critical CSS extraction / above-the-fold optimization (orthogonal concern)

## Decisions

### Decision 1: Per-component CSS map in the manifest

**Choice:** Add a `component_css` field to the manifest: `HashMap<String, ComponentCssFragments>` where `ComponentCssFragments` contains per-layer CSS strings for that single component.

**Why:** The manifest is already the bridge between Rust extraction and bundler plugins. Adding per-component CSS here keeps the architecture consistent. The existing concatenated `CssSheets` stays for single-file mode — the per-component map is additive.

**Alternative considered:** Emitting separate CSS files per component from Rust. Too granular — the bundler plugin should decide grouping based on route information the Rust crate doesn't have.

### Decision 2: Bundler plugin owns route grouping

**Choice:** The Vite plugin uses Rollup's chunk graph (available in `generateBundle` hook) to determine which components are in which route chunk. It groups component CSS by route and emits CSS assets via `this.emitFile()`.

**Why:** The Rust crate has no route awareness — it sees files, not routes. The bundler knows the import graph and chunk boundaries. This keeps route logic in the bundler layer where it belongs.

**Alternative considered:** Requiring the consumer to declare route → component mappings. Too manual, error-prone, and couples the CSS splitting to the routing config.

### Decision 3: Global chunk via existing virtual module

**Choice:** `virtual:animus/styles.css` becomes the global chunk: @layer declaration + theme variables + global styles + system utilities. Component CSS moves to per-route chunk files.

**Why:** The virtual module already has the right semantics — imported once at the root, always in the entry chunk. Changing its content from "everything" to "global only" is backward compatible in behavior (all styles still load, just from multiple files).

### Decision 4: Shared component hoisting threshold

**Choice:** Components used on more than N routes (configurable, default 2) are hoisted to the global chunk. This prevents the same component CSS from duplicating across many route chunks.

**Why:** Button, Card, Text — common components appear on every route. Including them in every route chunk wastes bytes. Hoisting to the global chunk means one copy. The threshold is configurable because the right cutoff depends on app size.

**Alternative considered:** Always deduplicating into a shared chunk (separate from global). More files, more `<link>` tags, more complexity. Hoisting to global is simpler and the global chunk is already cached.

### Decision 5: @layer blocks span chunks safely

**Choice:** Each route chunk wraps its component CSS in the appropriate `@layer` blocks. Multiple `@layer base { ... }` blocks across chunks are valid — the CSS spec says subsequent blocks append to the existing layer.

**Why:** The @layer declaration in the global chunk locks ordering. Route chunks just append rules. Even if route chunks load in any order, inter-layer ordering is guaranteed and intra-layer ordering is irrelevant (hash-scoped selectors).

## Risks / Trade-offs

**[More HTTP requests]** → Each route loads 1 additional CSS file. Mitigation: HTTP/2 multiplexing makes this cheap. The global chunk is cached after first load. Route chunks are small (only that route's components).

**[FOUC on route navigation]** → Client-side navigation to a new route loads a new CSS chunk. If CSS loads after JS renders, unstyled flash. Mitigation: framework-level prefetching (React Router `prefetch="intent"`, Next.js automatic prefetch). The CSS file is typically tiny and loads faster than the JS chunk.

**[Shared component threshold tuning]** → Wrong threshold = either too much duplication (threshold too high) or global chunk too large (threshold too low). Mitigation: configurable, with a sensible default (2). Provide build report showing chunk sizes.

**[Rollup chunk graph stability]** → Rollup's chunk assignments can change between builds if the import graph changes. A component might move between route chunk and global chunk. Mitigation: content-hash filenames ensure cache invalidation. The CSS content is deterministic regardless of which chunk it's in.

**[Extension chains across routes]** → If Card is on route A and FancyCard (extends Card) is on route B, both have self-contained CSS (extension merged at extraction time). No cross-chunk dependency. This is safe by construction.

## Open Questions

1. **Should per-route CSS be `<link>` tags or inline `<style>`?** Inline avoids the FOUC on navigation but doesn't cache. `<link>` caches but needs prefetching. Leaning toward `<link>` with framework prefetching.

2. **How does this interact with SSR streaming?** The global chunk is in the shell HTML. Route CSS could be injected as `<link>` tags when the route's Suspense boundary resolves. React 19's `precedence` system handles this but has known bugs. Needs empirical validation.

3. **What's the minimum app size where splitting pays off?** Single-file is simpler. At what component count does the per-route saving exceed the overhead of additional HTTP requests? Likely 50+ components across 5+ routes, but needs measurement.

4. **Should we emit a build report?** Showing global chunk size, per-route chunk sizes, which components were hoisted. Useful for tuning the threshold.
