## Why

The smoke test used static hex values (`colors.primary: '#6366f1'`) — no dark mode, no theme switching. Real applications need color modes: light/dark themes that swap colors without changing component CSS. The Animus theming package (`packages/theming/`) already supports this via CSS custom properties — `colors.primary` resolves to `var(--colors-primary)`, and color mode definitions set the variable values on `:root` or `[data-color-mode="dark"]`.

The extraction pipeline already handles CSS variables in the flattened theme — the doc site's theme has `colors.primary: 'var(--colors-primary)'` and extracted CSS correctly emits `color: var(--colors-primary)`. What's MISSING is who emits the variable DEFINITIONS — the `:root { --colors-primary: #6366f1 }` and `[data-color-mode="dark"] { --colors-primary: #a5b4fc }` blocks. Currently that's Emotion's `<Global>` component. Without Emotion, extraction must handle it.

## What Changes

- **CSS custom property definitions in extracted output**: The Vite plugin evaluates the theme's color modes at build time (via `serializeTokens` from `@animus-ui/theming`) and prepends the variable definitions to the extracted CSS output.
- **Theme evaluation at build start**: The plugin uses Vite's `ssrLoadModule()` to evaluate the actual theme module (not pre-serialized JSON), extracting both the flattened scale values AND the color mode variable definitions.
- **Color mode switching at runtime**: A minimal `<ColorModeProvider>` (or a standalone `<style>` tag) defines the CSS custom properties. No Emotion needed — pure CSS custom properties with a `[data-color-mode]` attribute selector.
- **Smoke test with dark mode**: Update the smoke test to include a light/dark toggle, proving color modes work with extracted CSS.

## Key Design Questions

1. **Where do variable definitions live?** Options: (a) prepended to the main `virtual:animus/styles.css`, (b) a separate `virtual:animus/theme.css` module, (c) a standalone `theme.css` file generated at build time.

2. **How is the theme module evaluated?** The `evaluateTheme` function in `vite-plugin/src/theme-evaluator.ts` was designed for this — it uses `ssrLoadModule()` to evaluate the theme builder chain and produces both flattened scales and CSS variable definitions. It was never actually wired in (the plugin currently accepts pre-serialized JSON).

3. **Color mode switching mechanism**: The Animus theming package has `useColorModes()` and `<ColorMode>` components that set a `data-color-mode` attribute. These are React components that currently depend on Emotion. They need a zero-dependency equivalent — likely just a `<script>` that reads localStorage and sets the attribute, plus CSS that uses `[data-color-mode="dark"]` selectors.

4. **Scale values that are CSS variables vs static**: Some scales are mode-dependent (colors, shadows, gradients → CSS variables) while others are static (space, fontSizes, radii → literal values). The flattened theme already handles this: mode-dependent scales produce `var(--x)` values, static scales produce literal values. The extraction pipeline treats them identically.

## Capabilities

### New Capabilities
- `theme-variable-emission`: The extraction pipeline emits CSS custom property definitions for color-mode-dependent theme tokens alongside the component CSS.
- `color-mode-runtime`: A minimal (<200 byte) runtime script that reads the preferred color mode from localStorage/prefers-color-scheme and sets `data-color-mode` on the root element.

### Modified Capabilities
- `vite-extraction-plugin`: `buildStart` evaluates the theme module via `ssrLoadModule()` to extract both flattened scales and variable definitions. Emits variable CSS alongside component CSS.

## Impact

- **`packages/vite-plugin/src/index.ts`**: Wire `evaluateTheme` with `ssrLoadModule`, emit variable CSS
- **`packages/vite-plugin/src/theme-evaluator.ts`**: Enhance to extract variable definitions alongside scale flattening
- **`packages/smoke-test/`**: Add dark mode toggle, verify color mode switching with extracted CSS
- **`packages/theming/`**: May need to export CSS variable definitions in a format consumable by the plugin
- **No Rust changes**: The Rust pipeline already handles `var(--x)` values correctly — it just resolves and emits them
