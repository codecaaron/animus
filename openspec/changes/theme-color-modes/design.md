## Context

The extraction pipeline produces component CSS that references CSS custom properties (e.g., `color: var(--color-primary)`). These var references are correct — the Rust `theme_resolver` resolves `color: 'primary'` against the flattened theme which contains `colors.primary: 'var(--color-primary)'`.

What's missing: the variable DEFINITIONS. The `:root { --color-primary: #6b21a8 }` and `[data-color-mode="dark"] { --color-primary: #ff80bf }` blocks that give those CSS vars their values. Currently Emotion's `<Global>` component emits these. Without Emotion, the Vite plugin must emit them alongside extracted component CSS.

The theming package (`packages/theming/`) already computes everything we need. `ThemeBuilder.build()` produces:
- `theme._variables.root` — raw color CSS var definitions (e.g., `--color-navy-500: #282a36`)
- `theme._variables.mode` — semantic color mode var definitions (e.g., `--color-primary: var(--color-purple-700)`)
- `theme._variables.shadows` / `gradients` — computed scale var definitions
- `theme._tokens.modes` — per-mode resolved hex values for all semantic tokens

The Vite plugin has an `evaluateTheme()` function in `theme-evaluator.ts` that was built for this but never wired in. It uses `ssrLoadModule()` to evaluate the theme module and flattens scales. It needs to ALSO extract `_variables` for CSS emission.

**Known tech debt:** The theming package imports `Theme` from `@emotion/react` (`serializeTokens.ts:2`) and core has pervasive `@emotion/react` type dependencies. This does NOT block this change — `ssrLoadModule` evaluates JS at runtime where types are irrelevant — but it's a seam that must be addressed for full Emotion exit.

## Goals / Non-Goals

**Goals:**
- Emit CSS variable definitions from the theme's `_variables` structure as part of extracted CSS output
- Support color mode switching via `[data-color-mode]` CSS attribute selectors
- Wire `evaluateTheme` with `ssrLoadModule` in the Vite plugin (replacing pre-serialized JSON for theme evaluation)
- Demonstrate with a smoke test dark mode toggle

**Non-Goals:**
- Removing Emotion type dependencies from `@animus-ui/core` or `@animus-ui/theming` (separate change)
- Server-side rendering of color mode preferences (pure client-side for now)
- Supporting arbitrary numbers of color modes (two modes — light/dark — is sufficient)
- Modifying the Rust extraction pipeline (it already handles `var(--x)` correctly)

## Decisions

### 1. Variable definitions prepended to `virtual:animus/styles.css`

**Decision:** CSS variable definitions are emitted at the TOP of the virtual CSS module, BEFORE the `@layer` declaration and component CSS. This ensures variables are defined before any component rule references them.

**Output shape:**
```css
/* --- Theme variable definitions --- */
:root {
  --color-navy-500: #282a36;
  --color-primary: var(--color-purple-700);
  --shadows-logo: 0.1em calc(0.07em * -1) ...;
  /* ... all _variables entries ... */
}

[data-color-mode="dark"] {
  --color-primary: var(--color-pink-600);
  --color-background: var(--color-navy-900);
  /* ... dark mode overrides only ... */
}

/* --- Extracted component CSS --- */
@layer base, variants, states, system, custom;
@layer base { ... }
```

**Rationale:** A single virtual module is simpler than two (`theme.css` + `styles.css`). CSS variable definitions don't participate in `@layer` — they're in the implicit default layer, which is correct. A separate module would require consumers to import both.

### 2. `evaluateTheme` returns both flat scales AND variable CSS

**Decision:** Enhance `evaluateTheme` to return an object `{ scalesJson: string, variableCss: string }` instead of just a flat JSON string. The `variableCss` is a ready-to-emit CSS string containing `:root` and `[data-color-mode]` blocks.

**Rationale:** Generating the CSS string in the theme evaluator (JS) rather than in the Rust crate keeps Rust changes at zero. The evaluator already has access to the full theme object including `_variables` and `_tokens.modes`. Converting `_variables` objects to CSS declarations is straightforward string manipulation.

**Variable-to-CSS conversion:**
The `_variables` structure is `{ root: { '--color-x': 'value' }, mode: { '--color-y': 'var(...)' }, shadows: { '--shadows-z': '...' } }`. Each nested object's entries become CSS declarations. The `mode` entries are the DEFAULT mode (initial mode from `addColorModes`). Dark mode overrides come from `_tokens.modes.dark` mapped through the raw color registry.

### 3. Color mode switching: dark mode CSS derived from `_tokens.modes`

**Decision:** The theme evaluator generates `[data-color-mode="dark"]` CSS by:
1. Reading `theme._tokens.modes.dark` (maps semantic names to resolved hex values)
2. For each semantic token, emitting `--color-{name}: {value}` (direct hex, not var references)
3. Non-default modes beyond light/dark follow the same pattern

**Why direct hex values, not var references for dark mode:** The `_tokens.modes.dark` object has already-resolved hex values. Using them directly is simpler and produces smaller CSS. Var-referencing (`--color-primary: var(--color-pink-600)`) would work but adds a level of indirection that only matters if raw colors change per-mode (they don't — only semantic aliases change).

Wait — actually, using var references is MORE correct. If someone overrides `--color-pink-600` globally, dark mode's `--color-primary` should pick up the override. Let me reconsider.

**Revised decision:** Use `_tokens.modes` keys to look up var references from the same registry that `addColorModes` used. Each mode entry maps semantic names to raw color keys. The CSS emitter maps those keys to `var(--color-{key})` references. This preserves the indirection chain and is more compositionally correct.

### 4. Smoke test: static `_variables` object instead of ThemeBuilder

**Decision:** The smoke test will construct a `_variables` object directly (not via `ThemeBuilder`) to avoid adding `@animus-ui/theming` as a dependency. A small set of color variables (primary, secondary, background, text) with light/dark modes is sufficient.

**Rationale:** The smoke test's purpose is to verify the extraction pipeline, not the ThemeBuilder. The ThemeBuilder's Emotion type dependency would pull Emotion into the smoke test. A manually constructed `_variables` object exercises the same Vite plugin code path.

### 5. Color mode runtime: inline `<script>` pattern

**Decision:** The smoke test demonstrates a minimal inline script pattern:
```html
<script>
  const mode = localStorage.getItem('color-mode')
    || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.dataset.colorMode = mode;
</script>
```

This runs before React hydration, preventing a flash of wrong colors. It's NOT a package export — it's a pattern to copy. A formal `@animus-ui/color-mode` package is a future concern.

**Rationale:** A <200 byte inline script is simpler and more performant than a React context provider for this specific task. The React-based `useColorModes()` from the theming package can be kept for dev-mode convenience but is not needed for extracted apps.

## Risks / Trade-offs

- **[`ssrLoadModule` availability]** → `ssrLoadModule` is only available in Vite's dev server and build pipeline. It won't work in non-Vite contexts. Mitigation: the plugin is already Vite-only. For future bundler plugins, theme evaluation will need a different mechanism.
- **[Theme module side effects]** → `ssrLoadModule` executes the theme module's JS, including any side effects (font imports, polished transforms). If the module has heavy side effects, build time increases. Mitigation: theme modules are typically pure computation. Document this expectation.
- **[Emotion type dependency in theming package]** → `serializeTokens.ts` imports `Theme` from `@emotion/react`. This doesn't block runtime evaluation but creates a compile-time dependency. Mitigation: note as tech debt; address in a separate "remove Emotion type dependencies" change.
- **[Dark mode flash on page load]** → Without the inline script, the page renders in light mode and then switches. Mitigation: the inline script pattern runs before React and prevents flash. Document it clearly.
