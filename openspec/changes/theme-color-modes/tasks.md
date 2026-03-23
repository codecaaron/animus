## 1. Enhance Theme Evaluator

- [ ] 1.1 Change `evaluateTheme` return type from `string` to `{ scalesJson: string, variableCss: string }`
- [ ] 1.2 Extract `theme._variables` (root, mode, shadows, gradients, breakpoints) and convert each to CSS declarations within a `:root { }` block
- [ ] 1.3 If `theme._tokens.modes` exists, generate `[data-color-mode="<mode>"]` blocks for each non-default mode, mapping semantic token keys to their CSS var references
- [ ] 1.4 Handle themes WITHOUT color modes gracefully — produce `:root` block only, no `[data-color-mode]` blocks

## 2. Wire evaluateTheme into Vite Plugin

- [ ] 2.1 In `buildStart`, detect whether `options.theme` is a JSON string or a file path. If file path, use `ssrLoadModule` to evaluate and call `evaluateTheme`
- [ ] 2.2 Store the `variableCss` string in the plugin closure alongside the manifest
- [ ] 2.3 In the `load` hook for the virtual CSS module, prepend `variableCss` before `manifest.css`
- [ ] 2.4 Maintain backward compatibility: if theme is provided as pre-serialized JSON, skip variable emission (no `_variables` available)

## 3. Smoke Test: Color Mode Support

- [ ] 3.1 Update the smoke test's static theme to include CSS variable definitions — construct a `_variables`-shaped object with root colors and two modes (light/dark)
- [ ] 3.2 Update the Vite config's theme to use the new format (either ssrLoadModule path or a manually constructed variable CSS string)
- [ ] 3.3 Add a color mode initialization script to `index.html` (localStorage + prefers-color-scheme → data-color-mode attribute)
- [ ] 3.4 Add a color mode toggle button to `App.tsx` that switches data-color-mode and persists to localStorage
- [ ] 3.5 Verify: `bun run build` produces CSS with `:root { --color-... }` and `[data-color-mode="dark"] { ... }` blocks
- [ ] 3.6 Verify: toggling dark mode in the running app visually changes colors without page reload

## 4. Integration Tests

- [ ] 4.1 Add test in `canary.test.ts`: theme with `_variables` → extracted CSS includes `:root` variable definitions before `@layer`
- [ ] 4.2 Add test: theme with modes → extracted CSS includes `[data-color-mode="dark"]` block
- [ ] 4.3 Add test: theme without modes → extracted CSS includes `:root` only, no `[data-color-mode]` blocks
