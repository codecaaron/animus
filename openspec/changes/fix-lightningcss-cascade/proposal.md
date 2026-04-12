# Fix Lightning CSS Cascade Declaration Destruction

## Problem

Lightning CSS `transform()` — used by our `postProcessCss` in the vite-plugin — destroys the `@layer` cascade declaration and displaces unlayered CSS.

### Observed behavior

**Input to Lightning CSS:**
```css
@layer reset, anm-global, anm-base, anm-variants, anm-compounds, anm-states, anm-system, anm-custom, overrides;
:root { --color-gray-50: #fafafa; ... }
@layer anm-global { body { margin: 0 } }
@layer anm-base { .foo { color: blue } }
```

**Output from Lightning CSS:**
```css
@layer reset;
@layer anm-global { body { margin: 0 } }
@layer anm-base { .foo { color: blue } }
@layer overrides;
:root { --color-gray-50: #fafafa; ... }
```

Two mutations:
1. **Combined `@layer` declaration stripped** — layer names with matching blocks are removed. Only layers without blocks survive as individual declarations.
2. **Unlayered `:root` variables moved to end** — after all `@layer` blocks.

### Impact

- The explicit cascade ordering statement is destroyed. Layer ordering falls back to first-appearance ordering — fragile and dependent on emission order.
- Consumer custom layers (e.g., blockworks' `reset, base, tokens, recipes`) lose their position in the unified declaration.
- Variables at the end of the file is structurally confusing (functionally OK since unlayered CSS > layered, but violates developer expectations).

### Confirmed in

- Showcase prod build: `packages/showcase/dist/assets/styles-*.css` starts with `@layer reset;@layer anm-global{` instead of the full declaration.
- Isolated reproduction: `lcssTransform({ code: input, minify: false })` — happens even without minification.
- Lightning CSS has no feature flag to disable this behavior.

## Proposed Direction

Don't pass the `@layer` declaration or variable CSS through Lightning CSS. Only process the layered block content.

### Option A: Split assembly return

`assembleStylesheet` returns `{ declaration, variables, layeredContent }` instead of a single string. The vite-plugin `load` hook concatenates:
```
declaration (raw) + variables (raw) + postProcessCss(layeredContent)
```

### Option B: Post-process reassembly

Keep `assembleStylesheet` as-is but extract the declaration and variables before postProcessCss, then prepend after:
```typescript
const { declaration, body } = splitDeclarationFromBody(assembled);
return declaration + postProcessCss(body, opts);
```

### Option C: Replace Lightning CSS with targeted processing

If Lightning CSS is only used for autoprefixing + minification, replace with targeted tools that don't rewrite `@layer` semantics. Autoprefixer via PostCSS, minification via esbuild (which Vite uses by default).

## Research Needed

- Does Vite's own CSS pipeline also run Lightning CSS on the `load()` return value? If so, Option A/B won't fully solve it.
- What is Lightning CSS actually giving us beyond what Vite provides? If it's redundant, Option C is cleanest.
- Does the next-plugin have the same issue? It assembles CSS differently.
- Check if `lightningcss` has GitHub issues tracking this @layer behavior — it may be considered a bug upstream.

## Key Files

- `packages/vite-plugin/src/index.ts` — `postProcessCss()` (line 146), `load` hook (line 719)
- `packages/extract/pipeline/assemble-stylesheet.ts` — `assembleStylesheet()`, `buildLayerDeclaration()`
- `packages/extract/src/css_generator.rs` — `generate_css_sheets_ordered()` builds `sheets.declaration`
