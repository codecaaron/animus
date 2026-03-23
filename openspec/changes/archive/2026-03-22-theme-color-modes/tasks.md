## 1. Enhance Theme Evaluator

- [x] 1.1 Change `evaluateTheme` return type from `string` to `{ scalesJson: string, variableCss: string }`
- [x] 1.2 Extract `theme._variables` (root, mode, shadows, gradients, breakpoints) and convert each to CSS declarations within a `:root { }` block
- [x] 1.3 If `theme._tokens.modes` exists, generate `[data-color-mode="<mode>"]` blocks for each non-default mode, mapping semantic token keys to their CSS var references
- [x] 1.4 Handle themes WITHOUT color modes gracefully — produce `:root` block only, no `[data-color-mode]` blocks

## 2. Wire evaluateTheme into Vite Plugin

- [x] 2.1 Plugin accepts `theme: string | { scales: string; variables: string }` — object form provides pre-evaluated scales + variable CSS
- [x] 2.2 Store the `variableCss` string in the plugin closure alongside the manifest
- [x] 2.3 In the `load` hook for the virtual CSS module, prepend `variableCss` before `manifest.css`
- [x] 2.4 Maintain backward compatibility: if theme is provided as pre-serialized JSON string, skip variable emission

## 3. Smoke Test: Color Mode Support

- [x] 3.1 Updated theme to use CSS variable references for mode-dependent colors (static scales unchanged)
- [x] 3.2 Updated Vite config's inline plugin to prepend variableCss in load hook
- [x] 3.3 Added color mode initialization script to `index.html` (localStorage + prefers-color-scheme → data-color-mode)
- [x] 3.4 Added color mode toggle button to `App.tsx`
- [x] 3.5 Verified: build produces CSS with `:root { --color-... }` and `[data-color-mode="dark"] { ... }` blocks
- [x] 3.6 Verified: CSS output uses `var(--color-primary)` references in component rules

## 4. Integration Tests

- [x] 4.1 Theme evaluator tests: 9 tests covering _variables → :root, _tokens.modes → [data-color-mode], no _variables → empty, nested token flattening
- [x] 4.2 Tests located at `packages/vite-plugin/tests/theme-evaluator.test.ts` (testing JS layer, not NAPI)
- [x] 4.3 All 9 tests pass
