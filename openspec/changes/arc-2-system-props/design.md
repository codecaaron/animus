## Context

Arc 1 built a Rust NAPI extraction pipeline that walks Animus builder chains, evaluates static styles/variants/states, and emits `@layer`-structured CSS with `createComponent()` source replacements. Chains containing `.groups()`, `.props()`, or `.extend()` bail to Emotion runtime.

The Animus prop system defines 13 named groups (space, color, layout, typography, flex, grid, borders, shadows, background, positioning, transitions, mode, vars) in `packages/core/src/config.ts`. Each group is a set of prop→CSS property mappings with optional theme scale references and value transforms. Components opt into groups via `.groups({ space: true, layout: true, ... })`, which determines which system props are available on their JSX API.

System props are used at JSX callsites with static literals and responsive objects: `<Box p={8} mt={{ _: 8, sm: 16 }} />`. Survey of all callsites in the codebase found zero dynamic expressions — all values are compile-time constants.

The existing `@layer` order is `base, variants, states, system, custom`. The `system` layer is currently unused. It exists precisely for this arc.

## Goals / Non-Goals

**Goals:**
- Extract `.groups()` and `.props()` stages from builder chains (stop bailing)
- Scan JSX callsites to collect static system prop values
- Emit shared utility CSS in `@layer system` for each unique (prop, value) pair
- Update runtime shim to map system props to utility class names
- Maintain cascade correctness: system props override states/variants/base per `@layer` ordering

**Non-Goals:**
- Dynamic system prop extraction (computed values, spread props, identifier references) — these are left unhandled, system props with dynamic values are simply not extracted
- Cross-file `.extend()` support (Arc 3)
- `.asComponent()` wrapping (Arc 3)
- Dev-mode / HMR extraction — production build only (same as Arc 1)
- Utility CSS deduplication across files at the Vite level — deduplication happens naturally because identical (prop, value) pairs produce identical class names; duplicate CSS rules are harmless and can be optimized later via Lightning CSS

## Decisions

### 1. Shared utility classes, not per-component classes

System prop CSS is shared across all components. `p={8}` on Box and `p={8}` on Text produce the same class name and CSS rule. The prop config is global (from `config.ts`), so the mapping is component-independent.

**Alternative considered:** Per-component utility classes (`.Box-p-8`, `.Text-p-8`). Rejected because it defeats the purpose of utilities — they belong to the design system, not to components. The component's `.groups()` config only determines which utilities are *available* on its type API; the CSS is the same.

### 2. Utility class naming: `animus-{prop}-{hash}`

Class name format: `animus-{propName}-{contentHash}` where content hash is derived from the resolved CSS value (after scale lookup + transform). This means `p={8}` and `p="0.5rem"` produce the same class if they resolve to the same CSS.

For responsive values, the hash covers the full responsive declaration including breakpoints: `animus-p-{hash({padding:0.5rem, @media(480px):{padding:1rem}})}`.

### 3. Two-phase extraction: chain walk then JSX scan

The pipeline executes in two phases per file:

```
Phase 1: Chain Walking (existing, modified)
  - Find .asElement()/.asComponent() terminals
  - Walk chain backwards, parse all stages including .groups() and .props()
  - Record active group prop names per component binding
  - Extract base/variants/states CSS into @layer base/variants/states (unchanged from Arc 1)

Phase 2: JSX Scanning (new)
  - Walk JSX elements in the file
  - Match element tag to a component binding from Phase 1 that has active groups
  - For each JSX attribute matching an active group prop:
    - Evaluate static value (literal number/string, responsive object)
    - Skip non-static values (identifiers, calls, spreads)
  - Collect unique (prop, value) pairs
  - Resolve through theme scales + transforms
  - Emit utility CSS in @layer system
  - Record prop→className mapping for runtime
```

**Alternative considered:** Single-pass extraction during chain walking. Rejected because the chain defines the SCHEMA (which props exist) while JSX defines the DATA (which values are used). These are separate AST locations requiring separate walks.

### 4. Runtime shim receives a system prop class map

The `createComponent()` call gains a `systemProps` parameter: a map from prop name to a map of values→class names.

```js
createComponent('div', 'animus-Box-abc123', {
  variants: { ... },
  states: { ... },
  systemProps: {
    p: { "8": "animus-p-x7f2a1", "16": "animus-p-b3c4d5" },
    mt: { "8|sm:16": "animus-mt-e6f7g8" }
  },
  systemPropNames: ["p", "px", "py", "pt", "pr", "pb", "pl", "m", "mx", ...]
})
```

At runtime, the shim looks up each system prop's value in the map. If found → apply the class. If not found (dynamic value not extracted) → the prop is ignored (no Emotion fallback in extracted mode). `systemPropNames` is used for DOM prop filtering.

**Alternative considered:** Emit the class map as a separate JSON file or CSS custom property. Rejected — the map is small (only USED values, not all possible values) and collocating it with the component keeps the dependency graph simple.

### 5. `.props()` handled identically to `.groups()` but with inline scales

Custom props from `.props()` are structurally identical to group props — they have `property`, `scale`, and `transform`. The only difference is the scale may be an inline object rather than a theme reference. The JSX scanner handles them the same way: find the value, resolve through the (possibly inline) scale, apply transform, emit utility class in `@layer custom` (not `@layer system`).

This preserves the cascade: `@layer custom` > `@layer system` > `@layer states`, matching the builder chain order `.states() → .groups() → .props()`.

### 6. Responsive utility classes use full @media blocks

A responsive value like `mt={{ _: 8, sm: 16 }}` produces a single utility class with embedded @media queries, not separate per-breakpoint classes:

```css
@layer system {
  .animus-mt-a1b2c3 {
    margin-top: 0.5rem;
  }
  @media (min-width: 768px) {
    .animus-mt-a1b2c3 {
      margin-top: 1rem;
    }
  }
}
```

**Alternative considered:** Separate breakpoint classes (Tailwind's `sm:mt-4` approach). Rejected because it requires the runtime to assemble multiple classes and understand breakpoint prefixes. A single class per responsive value is simpler and maps directly to how Animus already handles responsive values.

## Risks / Trade-offs

**[Risk] Utility CSS duplication across files** → Identical utility rules may appear in multiple files' CSS output. Mitigation: same class name = same rule, so duplicates are idempotent. Vite can concatenate and deduplicate at bundle time. Lightning CSS optimization (future arc) handles this cleanly.

**[Risk] Unextracted system props silently produce no styling** → If a system prop has a dynamic value that can't be extracted, the utility class won't exist and the runtime shim can't apply it. Mitigation: the Rust pipeline should emit a warning listing unextracted system props per component. In dev mode (no extraction), Emotion still handles everything.

**[Risk] Responsive value hash collisions** → Two different responsive value objects could theoretically hash to the same 8-char string. Mitigation: FNV-1a with 8 hex chars gives 2^32 space — collision probability is negligible for realistic codebases. Content-addressed naming ensures correctness (same content = same class is always safe).

**[Risk] JSX scanner performance on large files** → Scanning every JSX element adds a second AST walk. Mitigation: OXC parsing is fast (~1ms per file). The JSX walk is shallow — we only inspect attribute values of elements matching known bindings, skipping everything else.

**[Trade-off] No Emotion fallback for dynamic system props in extracted mode** → Unlike Arc 1 where chains either fully extract or fully bail, Arc 2 partially extracts: the chain's base/variants/states extract, but dynamic system prop values at specific callsites are simply dropped. This is acceptable because: (a) no dynamic system prop usage was found in the codebase, and (b) the type system constrains values to scale-valid options, making static usage the natural pattern.
