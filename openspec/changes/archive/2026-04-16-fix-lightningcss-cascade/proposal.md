## Why

Lightning CSS `transform()` destructively rewrites our CSS in ways that break structural intent. Three distinct mutations, confirmed empirically in session 78:

1. **`@layer` declaration stripped** — layer names with matching blocks are removed; ordering falls back to fragile first-appearance ordering.
2. **`:root` variables displaced to end** — after all `@layer` blocks, violating the canonical preamble ordering.
3. **Shorthand/longhand consolidation** — `padding: 8px; padding-left: 12px;` becomes `padding: 8px 8px 8px 12px;` even with `minify: false`. This is baked into Lightning CSS's parse→serialize roundtrip (confirmed: no config option to disable, upstream issues lightningcss#805, #146). Our Rust pipeline emits tier-ordered declarations (shorthand-first) that Lightning CSS silently collapses, masking tier-ordering bugs and destroying debuggable structure.

The only value Lightning CSS provides is autoprefixing (`-webkit-user-select` for modern targets) and minification — both available through Vite's native pipeline (PostCSS + esbuild) without the destructive rewriting.

Tailwind CSS tolerates Lightning CSS because utilities are single-property-per-class. Our component CSS has multi-property rules where declaration order encodes tier semantics (tier 0 shorthands → tier 1 multi-target → tier 2 longhands). This structural incompatibility is fundamental, not configurable.

## What Changes

- **Split `assembleStylesheet` return type**: new structured form returning `{ declaration, variables, body }` so consumers can protect preamble content from any CSS post-processor. Backward-compatible — string return remains the default.
- **Vite plugin uses split assembly**: `@layer` declaration and `:root` variables bypass `postProcessCss`; only the body (global + component CSS) passes through Lightning CSS for autoprefixing.
- **Next plugin uses split assembly**: structural clarity — writes declaration, variables, and body as distinct segments even though it doesn't use Lightning CSS. Enables future adoption of any CSS post-processor without re-discovering the same pitfalls.
- **Round-trip cascade correctness test**: new integration test that validates every multi-target shorthand combination (px+pl, py+pt, p+px+pl, etc.) through the full pipeline — Rust emission → Lightning CSS consolidation → computed value verification. Covers the "bridge" between JS object intent and final CSS.
- **Dev adopted stylesheet path protected**: the `RESOLVED_COMPONENTS_ID` load path strips any embedded `@layer` declaration from component CSS before passing to `postProcessCss`.

## Capabilities

### New Capabilities
- `css-post-processing-split`: structured stylesheet assembly with protected preamble, enabling CSS post-processors to operate on body content without destroying cascade declarations or variable positioning.
- `cascade-round-trip-testing`: integration test suite validating that multi-target prop expansion (px, py, mx, my) through tier-ordered emission and CSS post-processing produces correct computed values for all shorthand/longhand combinations.
- `layer-declaration-delivery`: `@layer` cascade declaration delivered via HTML `<style>` tag in Vite (bypassing all CSS pipelines), inline in CSS for Next.js (where the pipeline preserves it). Host-appropriate delivery ensures the declaration reaches the browser intact regardless of downstream processing.

### Modified Capabilities
- `css-post-processing`: existing capability gains the split assembly contract; vite-plugin `postProcessCss` now operates on body-only content; declaration removed from virtual module output (Vite only).
- `extract-pipeline`: `assembleStylesheet` gains overloaded return type (string | structured) via `split` option.

## Phase 2: HTML-Injected Layer Declaration (Vite Pipeline Bypass)

Session 78 discovered that the split alone is insufficient for Vite prod builds. Vite's own CSS pipeline (esbuild minification) runs AFTER our `load()` hook returns — it processes the concatenated virtual module output and strips `@layer` declarations that have matching blocks in the same file. This is not our Lightning CSS call; it's Vite-internal and unavoidable for CSS virtual modules.

**Solution:** Remove the `@layer` declaration from the CSS virtual module entirely. Inject it as a `<style>` tag in the HTML `<head>` via Vite's `transformIndexHtml` hook with `order: 'pre'` and `injectTo: 'head-prepend'`. The declaration is cascade metadata, not styles — it belongs in the document, not in a stylesheet that gets processed.

This approach:
- Completely sidesteps both our Lightning CSS and Vite's esbuild CSS processing
- Guarantees the declaration is the first thing in `<head>`, before any `<link>` or JS-injected stylesheets
- Fires on every page load in dev (sufficient — declaration is config-time, doesn't change during HMR)
- Bakes into `dist/index.html` in prod builds
- Requires NO changes to the Next plugin (Next's CSS pipeline doesn't strip `@layer` declarations)

Variables (`:root` blocks) remain in the virtual CSS module — Lightning CSS doesn't destructively rewrite custom properties, and variables need no special protection.

## Impact

- `packages/extract/pipeline/assemble-stylesheet.ts` — new `split` option, new return type, new exported interface
- `packages/vite-plugin/src/index.ts` — 3 call sites updated to use split assembly; `postProcessCss` receives body-only CSS; new `transformIndexHtml` hook injects `@layer` declaration into HTML head; `load()` hook no longer includes declaration in virtual module output
- `packages/next-plugin/src/plugin.ts` — 2 call sites updated to use split assembly for structural clarity (no HTML injection — not needed)
- `packages/_integration/__tests__/` — new round-trip cascade test file
- `packages/extract/tests/canary.test.ts` — existing `assembleStylesheet` tests gain split-mode coverage
- Existing integration test `post-processing.test.ts` — updated to cover split assembly
