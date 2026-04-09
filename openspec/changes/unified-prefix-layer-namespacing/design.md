## Context

Animus emits CSS across three nameable surfaces: `@layer` declarations, CSS custom properties (`--`), and class names. The `prefix` option in the Vite plugin already namespaces variables and classes, but `@layer` names are hardcoded strings in both Rust (`css_generator.rs`) and TS (`assemble-stylesheet.ts`). This creates an incomplete namespace boundary — a consumer using `prefix: 'acme'` gets `--acme-color-primary` but still emits bare `@layer base`, risking collision with other CSS on the page.

The 7 Animus layers (`global`, `base`, `variants`, `compounds`, `states`, `system`, `custom`) are defined as `ANIMUS_LAYERS` in `extract/pipeline/assemble-stylesheet.ts` and hardcoded as string literals in three Rust functions: `generate_css()`, `generate_sheets_from_slice()`, and `generate_utility_css_impl()`.

The existing `layers?: string[]` plugin option allows consumers to interleave their own layer names around the Animus layers, with `validateLayerOrder()` enforcing relative order. This composability must be preserved.

## Goals / Non-Goals

**Goals:**
- Single `prefix` config controls all three emission surfaces (layers, vars, classes)
- Use CSS native dot-notation sublayers (`acme.base`) for layer prefixing
- Compose cleanly with existing `layers[]` custom ordering — consumer layers stay unprefixed
- Zero behavioral change when `prefix` is not set (default)
- Layer prefixing applied at emission time — internal representations stay bare

**Non-Goals:**
- Separate `layerPrefix` config distinct from `prefix` — one knob, not two
- Dash-prefixed flat layers (`acme-base`) — dot notation is the CSS-native mechanism
- Prefixing consumer-provided layer names in the `layers[]` array — those are the consumer's namespace
- Runtime layer name resolution — this is purely a build-time CSS transform

## Decisions

### 1. Dot-notation sublayers over dash-prefix

**Choice:** `@layer acme.base` not `@layer acme-base`

**Rationale:** CSS `@layer` natively supports dot-separated sublayers. `acme.base` creates a proper sublayer of `acme`, meaning the browser understands the hierarchy. All Animus output lives inside one cascade layer namespace, and unlayered consumer CSS naturally wins without `!important`.

**Alternative considered:** Dash-prefixed flat layers (`acme-base`). Simpler string transform but loses native hierarchy semantics and doesn't provide cascade containment.

**Trade-off acknowledged:** Sublayer containment means all prefixed Animus styles are lower-specificity than unlayered CSS. This is desirable for a design system (consumer overrides always win) but could surprise consumers who expect layer-level parity with their own `@layer` declarations.

### 2. Prefix applied at two boundaries: Rust emission + TS assembly

**Choice:** Thread prefix through both the Rust NAPI calls and the TS `assembleStylesheet()` / `applyPrefix()` functions.

**Rationale:** CSS is emitted from two places: Rust generates per-component sheets (with `@layer X {` wrappers), and TS assembles the final stylesheet (with the `@layer` declaration line and global CSS). Both need to know the prefix.

**Alternative considered:** Apply prefix only in TS post-processing via regex. Simpler but fragile — regex-based `@layer` transforms are error-prone when layer names appear in both declaration lines and block wrappers, and the structured `CssSheets` object has per-layer fields that need correct naming.

### 3. Validation operates on bare names, prefixing applied after

**Choice:** `validateLayerOrder()` continues to work with unprefixed layer names. The consumer's `layers[]` config uses bare names (`'base'`, not `'acme.base'`). Prefixing is applied to the validated, ordered list at emission time.

**Rationale:** The consumer shouldn't need to know or repeat the prefix in their layer ordering config. `layers: ['reset', 'base', 'variants', ...]` reads cleanly and the prefix is applied uniformly.

### 4. `ANIMUS_LAYERS` stays bare

**Choice:** The `ANIMUS_LAYERS` constant remains `['global', 'base', 'variants', ...]` without prefix. A new helper function `prefixLayerName(name, prefix?)` handles the transform.

**Rationale:** The constant is the source of truth for layer identity, not presentation. Keeping it bare means validation, ordering logic, and structured sheet field names don't need to change.

## Risks / Trade-offs

**[Sublayer specificity shift]** → Consumers who adopt `prefix` get cascade containment — all Animus styles sit inside a sublayer, making them lower-priority than unlayered CSS. This is intentional and desirable but should be documented clearly. Mitigation: document the specificity implications in the `prefix` option's JSDoc and in any migration guide.

**[Hardcoded Rust strings]** → Three Rust functions have hardcoded `@layer` string literals. Threading a prefix parameter through is straightforward but touches hot paths in the extractor. Mitigation: the prefix is an `Option<String>` — when `None`, the existing hardcoded strings are used unchanged, so the default path has zero overhead.

**[Regex-based TS prefixing]** → `prefix.ts` uses regex to transform CSS variable names. Extending it to also handle `@layer` names adds regex complexity. Mitigation: layer names are a closed, known set (`ANIMUS_LAYERS`), so the regex can be precise rather than general-purpose.
