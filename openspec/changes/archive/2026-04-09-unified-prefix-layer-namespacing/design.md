## Context

Animus emits CSS across three nameable surfaces: `@layer` declarations, CSS custom properties (`--`), and class names. The `prefix` option in the Vite plugin already namespaces variables and classes, but `@layer` names are hardcoded strings in both Rust (`css_generator.rs`) and TS (`assemble-stylesheet.ts`). This creates an incomplete namespace boundary — a consumer using `prefix: 'acme'` gets `--acme-color-primary` but still emits bare `@layer base`, risking collision with other CSS on the page.

The 7 Animus layers (`global`, `base`, `variants`, `compounds`, `states`, `system`, `custom`) are defined as `ANIMUS_LAYERS` in `extract/pipeline/assemble-stylesheet.ts` and hardcoded as string literals in three Rust functions: `generate_css()`, `generate_sheets_from_slice()`, and `generate_utility_css_impl()`.

The existing `layers?: string[]` plugin option allows consumers to interleave their own layer names around the Animus layers, with `validateLayerOrder()` enforcing relative order. This composability must be preserved.

## Goals / Non-Goals

**Goals:**
- Single `prefix` config controls all three emission surfaces (layers, vars, classes)
- Use dash-prefixed flat layers (`acme-base`) for layer prefixing
- Compose cleanly with existing `layers[]` custom ordering — consumer layers stay unprefixed
- Zero behavioral change when `prefix` is not set (default)
- Layer prefixing applied at emission time — internal representations stay bare

**Non-Goals:**
- Separate `layerPrefix` config distinct from `prefix` — one knob, not two
- Dot-notation sublayers (`acme.base`) — they prevent interleaving with other frameworks' layers
- Prefixing consumer-provided layer names in the `layers[]` array — those are the consumer's namespace
- Runtime layer name resolution — this is purely a build-time CSS transform

## Decisions

### 1. Dash-prefix flat layers over dot-notation sublayers

**Choice:** `@layer acme-base` not `@layer acme.base`

**Rationale:** CSS dot-notation sublayers (`acme.base`) create a parent layer `acme` that contains all Animus layers. This prevents interleaving Animus layers with other frameworks' layers — any layer inserted between `acme.global` and `acme.base` must also be a sublayer of `acme`, which is not the case for Tailwind's `@layer base` or other third-party layers. Dash-prefixed flat layers are plain `@layer` names that sit at the same level as any other layer, enabling arbitrary interleaving in the `layers[]` config.

**Alternative considered:** Dot-notation sublayers (`acme.base`). Provides native CSS hierarchy semantics and cascade containment, but the sublayer boundary prevents consumers from interleaving non-Animus layers between Animus layers — a common need when compositing with frameworks like Tailwind.

**Trade-off acknowledged:** Flat dash-prefixed layers lose the automatic cascade containment of sublayers. Consumer overrides from unlayered CSS still win (unlayered CSS outranks any `@layer`), but consumers who use `@layer` for their own overrides must place their layer after the relevant Animus layers explicitly.

### 2. Prefix applied at two boundaries: Rust emission + TS assembly

**Choice:** Thread prefix through both the Rust NAPI calls and the TS `assembleStylesheet()` / `applyPrefix()` functions.

**Rationale:** CSS is emitted from two places: Rust generates per-component sheets (with `@layer X {` wrappers), and TS assembles the final stylesheet (with the `@layer` declaration line and global CSS). Both need to know the prefix.

**Alternative considered:** Apply prefix only in TS post-processing via `applyPrefix()` regex. Rejected — `applyPrefix()` only receives variable JSON/CSS, never `componentCss` or `globalCss`. Adding `@layer` regex handling would be dead code. All `@layer` emissions pass through controlled paths (Rust generators + TS assembly) that have direct prefix awareness.

### 3. `layers[]` is the actual `@layer` declaration — consumer writes final CSS names

**Choice:** When `prefix` is set, the consumer writes prefixed Animus names in `layers[]`: `['base', 'acme-global', 'acme-base', ...]`. `validateLayerOrder(layers, prefix?)` checks for `{prefix}-{name}` as the required subsequence. Names are emitted as-is — no silent transformation.

**Rationale:** When composing with other frameworks (Tailwind emits `@layer base`), the consumer needs to see and control the full cascade topology. The config must match what appears in CSS devtools. A bare `'base'` in the config is ambiguous — is it TW's base or Animus's? Writing `'acme-base'` eliminates that ambiguity.

**Alternative considered:** Consumer writes bare Animus names, prefix applied silently at emission. Simpler config but the config doesn't match CSS output, making cascade debugging harder when multiple frameworks share layer names.

### 4. `ANIMUS_LAYERS` stays bare

**Choice:** The `ANIMUS_LAYERS` constant remains `['global', 'base', 'variants', ...]` without prefix. A new helper function `prefixLayerName(name, prefix?)` handles the transform.

**Rationale:** The constant is the source of truth for layer identity, not presentation. Keeping it bare means validation, ordering logic, and structured sheet field names don't need to change.

## Risks / Trade-offs

**[Layer interleaving requirement]** → Consumers who adopt `prefix` and use custom `layers[]` must write the full dash-prefixed Animus names (`acme-base`) rather than bare names. This is more explicit config but correctly reflects what appears in CSS devtools. Mitigation: document the naming convention in the `prefix` option's JSDoc and in any migration guide.

**[Hardcoded Rust strings]** → Three Rust functions have hardcoded `@layer` string literals. Threading a prefix parameter through is straightforward but touches hot paths in the extractor. Mitigation: the prefix is an `Option<String>` — when `None`, the existing hardcoded strings are used unchanged, so the default path has zero overhead.

**[Regex-based TS prefixing]** → `prefix.ts` uses regex to transform CSS variable names. Extending it to also handle `@layer` names adds regex complexity. Mitigation: layer names are a closed, known set (`ANIMUS_LAYERS`), so the regex can be precise rather than general-purpose.
