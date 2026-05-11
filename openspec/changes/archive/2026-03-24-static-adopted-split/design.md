## Context

The extraction pipeline currently produces CSS at the right granularity — the Rust crate computes `base`, `variants`, `states` layer content separately via `generate_layer_content()`, then concatenates them into one string. The plugin holds `variableCss` and `globalCss` as separate strings from theme evaluation and global styles resolution. Everything is born structured but concatenated at two pipeline layers before delivery.

In dev mode, Vite serves virtual CSS modules as `<style>` tags. Any change to the virtual module replaces the entire tag, resetting all CSS animations. Component CSS changes frequently during development; layer declarations, variables, and global styles change only on geological reset (system/theme/config file edits — which trigger full page reload anyway).

The Constructable StyleSheets API (`new CSSStyleSheet()` + `document.adoptedStyleSheets` + `sheet.replaceSync()`) provides animation-safe CSS updates — the browser internally diffs unchanged rules when `replaceSync()` is called.

**Current CSS composition (single virtual module):**

```
virtual:animus/styles.css
├── variableCss           (plugin — theme-evaluator.ts)
│   ├── :root { --color-navy-500: ... }
│   └── [data-color-mode="dark"] { ... }
├── globalCss             (plugin — resolve-global-styles subprocess)
│   └── @layer global { reset + global styles }
└── resolvedComponentCss  (Rust — css_generator + project_analyzer)
    ├── @layer global, base, variants, states, system, custom;
    ├── @layer base { .animus-Scene-xxx { ... } ... }
    ├── @layer variants { ... }
    ├── @layer states { ... }
    ├── @layer system { ... }
    └── @layer custom { ... }
```

## Goals / Non-Goals

**Goals:**
- Rust crate returns structured per-layer CSS sheets instead of a concatenated blob
- Dev mode delivers component CSS via Constructable StyleSheet (animation-safe HMR)
- Dev mode delivers static CSS (layer decl + vars + globals) via regular Vite CSS module
- HMR bridge auto-injected by plugin, zero manual setup
- Production path unchanged — single CSS file, no bridge, no runtime
- Foundation for future CSS code-splitting (structured data enables `emitFile` per-page splits later)

**Non-Goals:**
- Production CSS code-splitting via `emitFile` (future change — data will be ready)
- Configurable `@layer` naming/ordering (separate concern, can build on this later)
- Per-component adopted stylesheets (one sheet for all component CSS is sufficient)
- Shadow DOM / web component scoping

## Decisions

### D1: Rust returns `CssSheets` struct alongside concatenated `css`

**Choice:** Add a `sheets: CssSheets` field to `UniverseManifest` with per-layer strings. Keep `css: String` populated as the concatenation.

**Why:** The data is already computed separately in `generate_css_ordered()` — base, variants, states each via `generate_layer_content_slice()`. Utility and custom CSS are generated separately in `project_analyzer.rs:651-665`. We just need to stop discarding the individual pieces. Keeping `css` ensures backward compatibility and the prod path doesn't need to change.

**Alternative considered:** Have the plugin split the concatenated string via regex. Rejected — fragile, and we'd be splitting something the Rust crate already has in split form.

**Rust struct:**
```rust
#[derive(Debug, Serialize, Deserialize)]
pub struct CssSheets {
    pub declaration: String,  // @layer global, base, ...;
    pub base: String,         // @layer base { ... }
    pub variants: String,     // @layer variants { ... }
    pub states: String,       // @layer states { ... }
    pub system: String,       // @layer system { ... }
    pub custom: String,       // @layer custom { ... }
}
```

### D2: Component CSS delivered as JS module, not CSS module

**Choice:** In dev mode, component CSS is served as a virtual JS module (`virtual:animus/components.js`) that exports a CSS string. A bridge module creates a `CSSStyleSheet` and calls `replaceSync()`. This bypasses Vite's `<style>` tag replacement entirely.

**Why:** Vite's CSS HMR always replaces the full `<style>` tag — there is no way to do partial updates through the CSS pipeline. By serving component CSS as a JS string, we control the update mechanism ourselves via the Constructable StyleSheets API.

**Alternative considered:** Vite `?inline` or `?raw` CSS imports. Rejected — virtual modules don't support query suffixes reliably, and we'd still need the bridge module anyway.

### D3: Bridge auto-injected via `transformIndexHtml`

**Choice:** The plugin injects a `<script type="module">` tag via Vite's `transformIndexHtml` hook that imports the bridge module. Dev-only — not injected during `command === 'build'`.

**Why:** No changes needed to `transform_emitter.rs` or per-file transforms. The bridge is a singleton that manages one adopted stylesheet for all component CSS. Injecting at the HTML level is the natural place for a singleton.

**Alternative considered:** Import bridge in every transformed file. Rejected — wasteful, bridge is a singleton. Alternative: import bridge in entry point (main.tsx). Rejected — requires user action.

### D4: Static CSS keeps the same virtual module ID

**Choice:** `virtual:animus/styles.css` continues to exist but now serves only the static portion (layer declaration + variables + globals). Transformed files still `import 'virtual:animus/styles.css'`.

**Why:** Zero changes to transform_emitter.rs. The import is already in every transformed file. The static content is what you want tree-shaken into the build — it's the baseline that every page needs.

### D5: Layer declaration lives in both static CSS and Rust output

**Choice:** The Rust crate continues to emit `@layer global, base, variants, states, system, custom;` in `sheets.declaration`. The static virtual CSS also emits it. Harmless duplication — re-declaring the same layer order is a no-op per CSS spec.

**Why:** Zero coordination needed between Rust and plugin about who owns the declaration. The adopted stylesheet's rules slot into already-declared layers regardless. This is the simplest option with no correctness risk.

### D6: Production path unchanged (for now)

**Choice:** In production (`command === 'build'`), the `load` hook concatenates all sheets back together and serves them as a single CSS file, identical to current behavior. No bridge injected.

**Why:** Production builds don't have the animation-reset problem (no HMR). The structured sheets data is available for future `emitFile`-based code-splitting but we don't need to use it yet.

## Risks / Trade-offs

**[Risk] Adopted stylesheet ordering vs `<style>` tag ordering** — Adopted stylesheets have different cascade position than `<style>` tags. Per spec, adopted stylesheets come AFTER `<style>` tags in the cascade. Since our component CSS is in declared `@layer`s, and layers take precedence over source order for unlayered CSS, this is fine. But if users have unlayered CSS that expects to override component styles by source order, this would break.
→ *Mitigation:* All Animus CSS is layered. Document that user overrides should use `@layer` or higher specificity, not source order.

**[Risk] Browser support for Constructable StyleSheets** — `adoptedStyleSheets` + `replaceSync()` requires Chrome 73+, Firefox 101+, Safari 16.4+. This is dev-only, so only the developer's browser matters.
→ *Mitigation:* Dev-only feature. Graceful fallback: if `CSSStyleSheet` constructor isn't available, fall back to `<style>` tag injection (current behavior). Log a warning.

**[Risk] Layer declaration duplication** — The `@layer` declaration appears in both the static CSS module and the adopted stylesheet (via Rust output). While spec-compliant, it's technically redundant.
→ *Mitigation:* Harmless per CSS spec. Could strip from Rust output later if desired, but not worth the coordination cost now.

**[Risk] HMR bridge state management** — If the bridge module is re-evaluated (e.g., during full HMR), it must not create duplicate adopted stylesheets.
→ *Mitigation:* Bridge checks for existing sheet before creating. Use a well-known property on the sheet object or a module-level singleton guarded by `import.meta.hot.data`.
