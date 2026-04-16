## Context

Lightning CSS `transform()` is used by `postProcessCss()` in the vite-plugin for autoprefixing and optional minification. It destructively rewrites `@layer` declarations, displaces `:root` variables, and consolidates shorthand/longhand declarations — all baked into the parse→serialize roundtrip with no configuration to disable.

The current flow: `assembleStylesheet()` produces a single CSS string → `postProcessCss()` runs Lightning CSS on it → returned from `load()` hook. The assembly ordering is correct; Lightning CSS's round-trip behavior corrupts it.

Vite does NOT run Lightning CSS on virtual module CSS by default (it uses PostCSS + esbuild for minification). Our `postProcessCss` is the only Lightning CSS pass.

The next-plugin does not use Lightning CSS — it writes CSS to disk via `writeFileSync`. This bug is vite-plugin only, but the structural split benefits both plugins.

**Empirical findings (session 78):**
- Lightning CSS consolidates properties even with `minify: false` — the `padding: 8px; padding-left: 12px;` → `padding: 8px 8px 8px 12px;` collapse is in the core transform, not just minification.
- esbuild preserves `@layer` declarations, `:root` position, and declaration order. It only consolidates during minification, and even then preserves file-level structure.
- Lightning CSS's `include`/`exclude` flags control transpilation features (vendor prefixes, nesting), NOT property consolidation. No knob exists.
- Upstream: lightningcss#805 (property order shuffling), #146 (shorthand prevention), rspack#7921 (downstream breakage).
- Autoprefixing benefit is minimal for modern targets: empirically just `-webkit-user-select: none`.

## Goals / Non-Goals

**Goals:**
- Preserve the full `@layer` cascade declaration in both dev and prod output
- Preserve `:root` variable CSS position (before layer blocks, unlayered)
- Keep autoprefixing for layer block content (the useful part of Lightning CSS)
- Validate that multi-target prop expansion through our tier system produces correct CSS after consolidation
- Both Vite and Next.js plugins consume the split assembly form

**Non-Goals:**
- Removing Lightning CSS entirely (it provides value for autoprefixing; full removal is a separate decision)
- Changing the Rust-side CSS generation (it emits correctly — tier-ordered, shorthands first)
- Changing the tier system design (tier 0→1→2→3 ordering is correct and intentional)
- Filing upstream Lightning CSS issues (can be done independently)

## Decisions

### Decision 1: Split `assembleStylesheet` return type

**Choice:** `assembleStylesheet` gains a `split?: boolean` option. When `split: true`, returns `{ declaration: string; variables: string; body: string }` instead of a single string.

- `declaration`: the `@layer` ordering statement — never post-processed
- `variables`: `:root` variable CSS + color mode selectors — never post-processed
- `body`: global CSS + component CSS — post-processed by Lightning CSS for autoprefixing

**Why structured return over regex splitting:** The assembler already knows the parts. Regex-based `splitDeclarationFromBody` is fragile — the declaration format could change, edge cases with comments or whitespace. Returning parts separately is structurally correct.

**Why three-part split (not two-part):** `variables` contains `:root` blocks and `[data-color-mode]` selectors. These are unlayered CSS that:
1. Lightning CSS displaces to end of file
2. Contain only CSS custom properties (no autoprefixing needed)
3. Are structurally part of the preamble — they belong before layer blocks

Separating variables from body prevents both the `:root` displacement and any future post-processor from touching custom property declarations.

### Decision 2: Backward-compatible overload

**Choice:** Default call (no `split` option) continues returning a single concatenated string. The `split: true` form is opt-in. Existing tests and any external consumers are unaffected.

**Why:** `assembleStylesheet` is exported from `@animus-ui/extract/pipeline`. Changing the default return type is a breaking API change. The next-plugin, integration tests, and canary tests all consume the string form today.

### Decision 3: Global CSS goes through Lightning CSS

`@layer anm-global { ... }` contains authored CSS (resets, global styles) that may use properties needing autoprefixing (e.g., `-webkit-font-smoothing`). It passes through Lightning CSS alongside component CSS as part of the `body` segment.

### Decision 4: Dev adopted stylesheet path also protected

In dev mode, component CSS goes through the adopted stylesheet bridge (`RESOLVED_COMPONENTS_ID`). This path passes `resolvedComponentCss` to `postProcessCss`. The component CSS from Rust may contain an embedded `@layer` declaration (from `sheets.declaration`). This must be stripped before post-processing via `stripLeadingLayerDeclaration` (already exists in assemble-stylesheet.ts).

### Decision 5: Round-trip test uses real NAPI pipeline

The cascade correctness test must exercise the REAL Rust pipeline (via `analyzeProject`) rather than hand-constructing CSS. This validates the actual tier ordering, multi-target expansion, and theme resolution — the full bridge from JS object to CSS. The test then passes the emitted CSS through Lightning CSS `transform()` and verifies computed values match expectations.

### Decision 6: `@layer` declaration delivered via HTML `<style>` tag (Vite only)

**Choice:** The `@layer` declaration is injected into the HTML document head as a `<style>` tag via Vite's `transformIndexHtml` hook, rather than included in the CSS virtual module.

**Why not keep it in the virtual module:** Vite's own CSS pipeline (esbuild minification) runs after our `load()` hook returns. It processes the combined CSS output and strips `@layer` declarations that have matching `@layer name { ... }` blocks in the same file. This is Vite-internal behavior, not our Lightning CSS call — the split protects from our post-processing but not from Vite's. Confirmed empirically: showcase prod output showed `@layer reset;` (only orphan layers preserved) instead of the full declaration.

**Why `transformIndexHtml`:**
- `order: 'pre'` runs before Vite's own HTML transforms
- `injectTo: 'head-prepend'` places the `<style>` as the first child of `<head>`, before any `<link>` or JS-injected stylesheets
- In dev mode, fires on every page load (not HMR — but the declaration is config-time and never changes mid-session)
- In prod mode, bakes directly into `dist/index.html`

**Why Next plugin is unchanged:** Next.js's CSS pipeline does not strip `@layer` declarations. The CSS import approach (webpack `processAssets` hook) preserves structural metadata. No HTML injection is needed.

**Why variables stay in the virtual module:** Lightning CSS does not destructively rewrite CSS custom properties. `:root` variable blocks and color mode selectors survive both our `postProcessCss` and Vite's internal processing intact. Only the `@layer` declaration is vulnerable.

## Risks / Trade-offs

**[Risk] Lightning CSS may strip the `@layer` declaration from the body too** → The body only contains `@layer name { ... }` blocks, never the standalone declaration. Lightning CSS strips declarations when blocks for those layers exist in the same input. Since the standalone declaration is removed from the body, this risk is eliminated by design.

**[Risk] Consumers using `assembleStylesheet` directly get a different return type** → Mitigated by Decision 2: split is opt-in, default return is unchanged.

**[Risk] Dev mode adopted stylesheet path** → Mitigated by Decision 4: strip `@layer` declaration before `postProcessCss` in the bridge path.

**[Risk] Property consolidation still occurs in body segment** → Yes, Lightning CSS will still consolidate shorthand/longhand within the body. This is semantically correct (computed values match) but destroys structural debuggability. The round-trip test (Decision 5) validates correctness. Full removal of Lightning CSS is deferred to a separate decision.

**[Risk] Vite internal CSS pipeline strips structural metadata** → RESOLVED by Decision 6. The `@layer` declaration never enters the CSS pipeline — it's delivered via HTML `<style>` tag injection.

**[Risk] `transformIndexHtml` doesn't fire on HMR** → Acceptable. The `@layer` declaration is derived from the `layers` plugin option, which is config-time and static. It doesn't change during a dev session. Full page refresh picks up any config change.

**[Risk] SSR / non-SPA Vite usage** → `transformIndexHtml` has different behavior in SSR mode. The current plugin is SPA-focused. SSR support can be addressed as a follow-up if needed.

**[Trade-off] Keeping Lightning CSS vs dropping it** → This change protects the preamble without removing Lightning CSS. The remaining consolidation in the body is semantically correct. Dropping Lightning CSS entirely would give full structural preservation but loses autoprefixing. That's a separate, larger decision.
