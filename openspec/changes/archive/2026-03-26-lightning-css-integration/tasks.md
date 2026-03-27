## 1. Dependencies & Configuration Surface

- [x] 1.1 Add `lightningcss` and `browserslist` as dependencies to `packages/vite-plugin/package.json`
- [x] 1.2 Extend the plugin's config type to accept `targets?: string | string[]` and `minify?: boolean` options
- [x] 1.3 Add target resolution logic: explicit config → project browserslist → `defaults` fallback. Resolve once at `configResolved` or `buildStart`, cache in closure.

## 2. Core Post-Processing Function

- [x] 2.1 Implement `postProcessCss(css: string, options: { minify: boolean, targets: Targets }): string` using Lightning CSS `transform()` API
- [x] 2.2 Add graceful degradation: try/catch around Lightning CSS calls, fallback to unprocessed CSS with console warning on failure
- [x] 2.3 Verify @layer blocks are preserved (no cross-name merging) — write a focused unit test
- [x] 2.4 Verify var() references pass through untouched — write a focused unit test

## 3. Plugin Integration — Production Path

- [x] 3.1 Wire `postProcessCss()` into the prod `virtual:animus/styles.css` load hook, after transform resolution and unit fallback, with `minify: true`
- [x] 3.2 Verify the full prod pipeline: extraction → transform resolution → unit fallback → Lightning CSS → minified output

## 4. Plugin Integration — Dev Path

- [x] 4.1 Wire `postProcessCss()` into the dev `virtual:animus/styles.css` load hook (layer declaration + variables + globals) with `minify: false`
- [x] 4.2 Wire `postProcessCss()` into the dev `virtual:animus/components.js` load hook (component CSS string) with `minify: false`
- [x] 4.3 Wire `postProcessCss()` into the HMR update path so re-generated component CSS is autoprefixed before serving via the HMR bridge

## 5. Showcase Validation

- [x] 5.1 Run `bun run verify:showcase` — prod build succeeds, CSS is minified and autoprefixed
- [x] 5.2 Compare prod CSS size before and after (expect meaningful reduction from minification)
- [x] 5.3 Spot-check autoprefixed output for expected vendor prefixes (e.g., `-webkit-backdrop-filter` if present in showcase CSS)
- [x] 5.4 Run dev server — verify CSS is readable (not minified) but autoprefixed in browser devtools

## 6. Canary Tests

- [x] 6.1 Add canary test: post-processed CSS preserves all 6 @layer blocks in correct order
- [x] 6.2 Add canary test: post-processed CSS preserves var() references
- [x] 6.3 Add canary test: minified CSS is smaller than raw CSS
