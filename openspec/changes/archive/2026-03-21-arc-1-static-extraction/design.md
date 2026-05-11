## Context

Animus is a type-state machine CSS-in-JS framework where builder chain order enforces cascade priority. Today, all styles are computed at runtime via Emotion. The chain's strict ordering (styles → variants → states → groups → props) maps directly to CSS `@layer` declarations — a mapping no other framework implements.

A previous JS/Babel-based extraction POC was unacceptably slow and was abandoned. This design uses a Rust crate composing production-grade crates (the same way Rolldown is built) to achieve 5-10x faster extraction than JS-based approaches.

The existing builder API is stable and unchanged. The theming system already generates CSS custom properties for color modes, which means scale lookups resolve to CSS variable references — already static.

## Goals / Non-Goals

**Goals:**
- Extract static builder chains to `@layer`-structured CSS at build time
- Replace Emotion runtime with ~500 byte shim for extracted components
- Handle pseudo-selectors, responsive objects, multi-variant chains, theme scale lookups
- Bail gracefully to Emotion for non-extractable chains
- Production-only extraction (dev mode unchanged)

**Non-Goals:**
- System prop extraction (`.groups()`) — Arc 2
- Cross-file `.extend()` support — Arc 3
- `.asComponent()` wrapping — Arc 2+
- `.props()` custom prop extraction — Arc 2
- Dead variant elimination (usage-based tree shaking) — Arc 4
- Dev mode extraction or HMR support — future arc
- Any changes to the builder chain API or extension system

## Decisions

### 1. Rust Crate Composing OXC + Lightning CSS + string_wizard

**Choice**: Single Rust crate at `packages/extract/` that links OXC, Lightning CSS, string_wizard, and NAPI-RS at compile time. Exposed to JS via one NAPI function.

**Alternatives considered**:
- **Pure JS with Rolldown's transform hook**: Rolldown's `transform` hook provides pre-parsed AST and magic-string. But JS-based AST walking is 5x slower than native at Blockworks scale (8ms vs 1.6ms per file). At 1,789 files with cascade invalidation, this compounds to seconds.
- **SWC plugin**: OXC is Rolldown's parser and the future of the VoidZero ecosystem. SWC is architecturally divergent.
- **Babel plugin**: Already failed. Too slow, too much overhead.

**Rationale**: This is crate composition, not FFI. The Rust binary links all crates at compile time. The only JS↔Rust boundary crossing is the single `extract()` call per file.

### 2. Shared @layer Set (Not Per-Component)

**Choice**: All components inject into the same 5 layers: `@layer base, variants, states, system, custom`.

**Alternatives considered**:
- **Per-component layers** (`@layer Button.base, Button.variants`): Creates O(n) layer declarations. At 1,789 components, the layer order declaration alone would be enormous. Also makes extension ordering impossible without knowing the full component tree.

**Rationale**: Shared layers match the builder chain's semantic meaning. `.styles()` IS `@layer base` — not "this component's base." Extensions emit after parents within the same layer (same specificity, later source order wins).

### 3. Theme Evaluation at Build Start

**Choice**: The Vite plugin evaluates the theme module at `buildStart` using Vite's `ssrLoadModule()`, flattens all scales to `HashMap<(scale_name, key), css_value>`, serializes to JSON, and passes to every Rust `extract()` call.

**Alternatives considered**:
- **Static analysis of theme**: The theme uses functions (`addScale('shadows', ({ colors }) => ...)`) that depend on computed color values. Static analysis can't evaluate these.
- **Embed theme in Rust crate**: Would couple the crate to specific theme shapes.

**Rationale**: The theme only changes on full rebuild, not per-file. Evaluating once at build start and passing as serialized JSON is both correct and fast.

### 4. Deterministic Class Name Strategy

**Choice**: `animus-{binding}-{contenthash8}` where `binding` is the JS variable name and `contenthash` is an 8-char hash of the normalized chain descriptor.

**Rationale**: Binding name provides debuggability. Content hash provides uniqueness and cache stability. Same chain content = same hash = same class name across builds.

### 5. Bail-to-Emotion as First-Class Feature

**Choice**: Non-extractable chains are left completely untouched. The Rust crate returns `extractable: false` with a reason, and the Vite plugin skips the file transformation.

**Rationale**: The @layer specificity trap means unlayered CSS (Emotion) ALWAYS beats layered CSS. If we partially extract a chain, the unlayered runtime styles will override the layered extracted styles. Extraction must be all-or-nothing per chain.

### 6. Pipeline Stage Architecture

```
SOURCE (.ts/.tsx)
    │
    ▼
┌─────────────────────────────────────────┐
│  1. PARSE (oxc_parser)                  │
│     TS/TSX → zero-copy arena AST        │
├─────────────────────────────────────────┤
│  2. WALK (oxc traverse)                 │
│     Find terminals (.asElement)         │
│     Walk chain backwards to root        │
│     Extract method args as AST spans    │
├─────────────────────────────────────────┤
│  3. EVALUATE (custom + oxc const eval)  │
│     ObjectExpression AST → style values │
│     Separate pseudo-selectors from props│
│     Bail on non-static expressions      │
├─────────────────────────────────────────┤
│  4. RESOLVE (theme + config)            │
│     Prop name → CSS property (config)   │
│     Value → theme scale lookup          │
│     Apply transforms (size, border, etc)│
├─────────────────────────────────────────┤
│  5. GENERATE CSS (string building)      │
│     Style values → @layer CSS rules     │
│     Responsive → @media queries         │
│     Pseudo selectors → nested rules     │
├─────────────────────────────────────────┤
│  6. REPLACE SOURCE (string_wizard)      │
│     Chain expression → shim import      │
│     Add CSS import statement            │
└─────────────────────────────────────────┘
    │                    │
    ▼                    ▼
  CSS file          Transformed JS
```

### 7. Prop Config Serialization

**Choice**: Serialize the prop config from `config.ts` (all 13 prop groups with their property/scale/transform mappings) to JSON at build start. Pass to Rust alongside theme JSON.

**Challenge**: Transforms are JS functions (`size`, `borderShorthand`, `gridItemRatio`). These cannot be serialized.

**Solution**: Reimplement the 4 transforms in Rust (< 100 lines total). The serialized config includes a `transform` field with a string identifier (`"size"`, `"borderShorthand"`, `"gridItemRatio"`) that the Rust crate maps to its native implementation.

## Risks / Trade-offs

**[Cross-platform binary distribution]** → NAPI-RS handles this with per-platform npm packages (`@animus-ui/extract-darwin-arm64`, etc.). Established pattern used by Rolldown, SWC, Biome.

**[@layer browser support]** → CSS `@layer` is supported in all modern browsers (Chrome 99+, Firefox 97+, Safari 15.4+). For the target audience (React apps), this is sufficient. No polyfill needed.

**[Theme evaluation timing]** → `ssrLoadModule()` requires Vite's module graph to be ready. Using `buildStart` hook should be sufficient. If theme imports are complex, may need `configResolved` + lazy evaluation on first transform.

**[Content hash stability]** → Class names must be stable across builds for caching. The hash input must be the normalized chain descriptor (sorted keys, resolved values), not source positions or whitespace.

**[Emotion/extracted CSS specificity conflict]** → Unlayered CSS always beats layered CSS. If a page has both extracted components (layered) and Emotion components (unlayered), the Emotion styles will win in conflicts. This is correct behavior — non-extracted components should use runtime styles. But it means you cannot partially extract an extension chain: if parent extracts and child doesn't (or vice versa), the cascade breaks. Arc 1 has no extensions, so this is deferred.

**[OXC API stability]** → OXC is pre-1.0 and APIs may change. Pin exact versions in Cargo.toml. The surface area we use (parser, basic traverse) is stable.
