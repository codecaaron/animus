## Why

The virtual CSS module (`virtual:animus/styles.css`) currently serves one monolithic blob: layer declaration + variables + reset + global styles + component CSS. The data is *born structured* — the Rust crate computes base/variants/states/system/custom CSS separately via `generate_layer_content()`, then concatenates them. The plugin holds `variableCss` and `globalCss` as separate strings, then concatenates those too. We discard natural boundaries at two layers of the pipeline.

In dev mode, Vite's HMR replaces the entire `<style>` tag on any change, which resets all CSS animations — even when only one component's styles changed. The reset/global/variables content never changes during active development (only on geological reset), yet it's re-injected on every HMR cycle.

**Stop discarding the structure.** Return structured sheets from Rust, let the plugin decide delivery strategy per environment.

## What Changes

- **Rust crate returns structured CSS sheets** — instead of one concatenated `css: String`, the manifest includes a `sheets` object with per-layer CSS strings (declaration, base, variants, states, system, custom). The concatenated `css` field is kept for backward compatibility.
- **Plugin splits delivery into two mechanisms (dev mode):**
  - **Static virtual CSS** (`virtual:animus/styles.css`) — `@layer` declaration + `:root` variables + color mode selectors + `@layer global { reset + global styles }`. Regular Vite CSS module (`<style>` tag), only changes on geological reset (full page reload anyway).
  - **Adopted StyleSheet** via JS bridge — component CSS (`@layer base/variants/states/system/custom`) served as a JS module exporting a CSS string. Bridge creates a `CSSStyleSheet`, calls `replaceSync()`. Animation-safe — browser internally diffs unchanged rules.
- **Production: unchanged.** Single static CSS file (all sheets concatenated), no bridge, no runtime.
- **HMR bridge auto-injected** via `transformIndexHtml` hook. ~20 lines, dev-only. Zero prod bundle impact.
- **Future (not this change):** `emitFile` API for prod CSS code-splitting (static globals CDN-cacheable separately from per-page component CSS). Provenance chain already provides the data for this.

## Capabilities

### New Capabilities
- `structured-css-sheets`: Rust crate returns per-layer CSS strings instead of a single concatenated blob
- `dev-stylesheet-management`: Dev-mode CSS delivery via static virtual CSS (globals) + Constructable StyleSheet (components), with animation-safe `replaceSync()` HMR updates

### Modified Capabilities

## Impact

- `packages/extract/src/css_generator.rs` — return per-layer strings instead of concatenating
- `packages/extract/src/project_analyzer.rs` — add `sheets` field to `UniverseManifest`
- `packages/vite-plugin/src/index.ts` — split `load` hook into two virtual modules, add HMR bridge injection via `transformIndexHtml`
- `packages/vite-plugin/src/hmr-bridge.ts` — new, dev-only client module (~20 lines)
- Production build path: unchanged (concatenates sheets back together)
- Browser requirement: Constructable StyleSheets (`adoptedStyleSheets` + `CSSStyleSheet.replaceSync()`) — supported in all evergreen browsers since 2023
