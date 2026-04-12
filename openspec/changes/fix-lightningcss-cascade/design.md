## Context

Lightning CSS `transform()` is used by `postProcessCss()` in the vite-plugin for autoprefixing and optional minification. It destructively rewrites `@layer` declarations and reorders unlayered CSS, breaking the cascade contract.

The current flow: `assembleStylesheet()` produces a single CSS string → `postProcessCss()` runs Lightning CSS on it → returned from `load()` hook. The assembly ordering is correct; Lightning CSS's round-trip behavior corrupts it.

Vite does NOT run Lightning CSS on virtual module CSS by default (it uses PostCSS + esbuild). Our `postProcessCss` is the only Lightning CSS pass.

The next-plugin does not use Lightning CSS — it writes CSS to disk via `writeFileSync`. This bug is vite-plugin only.

## Goals / Non-Goals

**Goals:**
- Preserve the full `@layer` cascade declaration in both dev and prod output
- Preserve `:root` variable CSS position (before layer blocks, unlayered)
- Keep autoprefixing for layer block content (the useful part of Lightning CSS)
- Fix applies to both default and custom layer configurations

**Non-Goals:**
- Removing Lightning CSS entirely (it provides value for autoprefixing)
- Changing the Rust-side CSS generation (it emits correctly)
- Fixing the next-plugin (not affected)
- Filing an upstream Lightning CSS issue (can be done independently)

## Decisions

### Decision 1: Split `assembleStylesheet` return type (Option A from proposal)

**Choice:** `assembleStylesheet` returns `{ declaration: string, body: string }` instead of a single string.

- `declaration`: the `@layer` ordering statement + variable CSS (never post-processed)
- `body`: global CSS + component CSS (post-processed by Lightning CSS for autoprefixing)

**Why over Option B (post-hoc splitting):** Regex-based splitting (`splitDeclarationFromBody`) is fragile — the declaration format could change, edge cases with comments or whitespace. The assembler already knows the parts; returning them separately is structurally correct.

**Why over Option C (replace Lightning CSS):** Lightning CSS provides autoprefixing in a single fast pass. Replacing it adds a PostCSS dependency or removes autoprefixing entirely. The fix is surgical — protect what Lightning CSS breaks, keep what it does well.

### Decision 2: Variable CSS is "protected" content alongside the declaration

Variable CSS (`:root { --color-*: ... }` + `[data-color-mode]` selectors) must not pass through Lightning CSS because:
1. Lightning CSS displaces it to end of file
2. Variables contain no properties that need autoprefixing (CSS custom properties are already standard)
3. Variable CSS is structurally part of the "preamble" — it belongs before layer blocks

### Decision 3: Global CSS goes through Lightning CSS

`@layer anm-global { ... }` contains authored CSS (resets, global styles) that may use properties needing autoprefixing (e.g., `-webkit-font-smoothing`). It passes through Lightning CSS alongside component CSS.

## Risks / Trade-offs

**[Risk] Lightning CSS may strip the `@layer` declaration from the body too** → The body only contains `@layer name { ... }` blocks, never the standalone declaration. Lightning CSS only strips declarations when blocks for those layers exist in the same input. Since the declaration is removed from the body, this risk is eliminated by design.

**[Risk] Consumers using `assembleStylesheet` directly get a different return type** → `assembleStylesheet` is exported from `@animus-ui/extract/pipeline`. The next-plugin uses it. Changing the return type is a breaking API change. Mitigation: provide both — keep the string return as default, add a `split: true` option that returns the structured form. Or: add a new `assembleStylesheetParts()` function.

**[Risk] Dev mode adopted stylesheet path** → In dev, component CSS goes through the adopted stylesheet bridge, not the virtual module. The bridge receives `resolvedComponentCss` which includes `sheets.declaration`. Lightning CSS runs on this too (line 754). The declaration in the bridge CSS should also be protected. Mitigation: strip the declaration from component CSS before passing to `postProcessCss` in the bridge path.
