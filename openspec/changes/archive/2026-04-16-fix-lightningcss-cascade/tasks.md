# Tasks: fix-lightningcss-cascade

## 1. assembleStylesheet split return

- [x] Add `AssembleStylesheetParts` interface to `packages/extract/pipeline/assemble-stylesheet.ts`: `{ declaration: string; variables: string; body: string }`
- [x] Add `split?: boolean` option to `AssembleStylesheetOptions`
- [x] Implement overloaded return: when `split: true`, return `AssembleStylesheetParts` where declaration = `@layer` statement, variables = variableCss, body = globalCss + componentCss (with embedded `@layer` declaration stripped)
- [x] Default (no split) continues returning a single concatenated string for backward compatibility
- [x] Export `AssembleStylesheetParts` from `packages/extract/pipeline/index.ts`

## 2. Vite plugin — prod mode load hook

- [x] In `load()` hook prod path (`id === RESOLVED_CSS_ID`, `!storedSheets` branch), call `assembleStylesheet` with `split: true`
- [x] Run `postProcessCss` on `body` only
- [x] Concatenate back: `declaration + '\n' + variables + '\n' + processedBody` as the single return value (one virtual module, one CSS output) — **SUPERSEDED by §10**: declaration now moves to HTML `<style>` tag; `load()` returns `variables + '\n' + processedBody` only

## 3. Vite plugin — dev mode load hook

- [x] In `load()` hook dev path (`id === RESOLVED_CSS_ID`, `storedSheets` branch), call `assembleStylesheet` with `split: true` (dev has no componentCss here — it goes through adopted stylesheet)
- [x] Run `postProcessCss` on `body` only (global CSS), `minify: false`
- [x] Concatenate back: `declaration + '\n' + variables + '\n' + processedBody` — **SUPERSEDED by §10**: declaration now moves to HTML `<style>` tag; `load()` returns `variables + '\n' + processedBody` only

## 4. Vite plugin — adopted stylesheet (dev HMR bridge)

- [x] In `RESOLVED_COMPONENTS_ID` load path, strip any embedded `@layer` declaration from `resolvedComponentCss` before passing to `postProcessCss` using `stripLeadingLayerDeclaration` (already exported from assemble-stylesheet.ts)

## 5. Next plugin — split assembly

- [x] In `buildStart` (line ~571), call `assembleStylesheet` with `split: true`
- [x] Concatenate `declaration + '\n' + variables + '\n' + body` for the full CSS string passed to `setSharedCss()` / `writeFileSync`
- [x] In HMR rebuild path (line ~853), same pattern
- [x] No post-processing change needed (next-plugin doesn't use Lightning CSS)

## 6. Canary test coverage

- [x] Add split-mode tests to `packages/extract/tests/canary.test.ts` in the existing `assembleStylesheet: anm- layer names` describe block
- [x] Test: `split: true` returns object with `declaration`, `variables`, `body` keys
- [x] Test: `declaration` contains `@layer` statement, not in `body`
- [x] Test: `variables` contains `:root` block, not in `body`
- [x] Test: `body` contains `@layer anm-global {`, `@layer anm-base {`, etc.
- [x] Test: concatenated `declaration + variables + body` equals non-split return

## 7. Integration test — post-processing split

- [x] Update `packages/_integration/__tests__/post-processing.test.ts` assembleStylesheet tests for split mode
- [x] Test: split form + Lightning CSS on body-only preserves `@layer` declaration intact
- [x] Test: split form + Lightning CSS on body-only preserves `:root` position (it's not in the body)

## 8. Round-trip cascade correctness test

- [x] Create `packages/_integration/__tests__/cascade-round-trip.test.ts`
- [x] Define fixture components covering all multi-target combinations: `px+pl`, `py+pt`, `px+py+pt`, `p+px`, `p+px+pl`, `p+px+py+pt+pb`, `mx+ml`, `my+mt`, `m+mx+ml` (use test-system.ts fixture or inline fixture)
- [x] Run through `analyzeProject` to get real Rust-emitted CSS for each component
- [x] For each component's CSS rule block, extract the declarations
- [x] Pass through Lightning CSS `transform({ minify: false })` — verify consolidated shorthand values match expected computed values
- [x] Pass through Lightning CSS `transform({ minify: true })` — same verification
- [x] Pass through esbuild `transform({ minify: true, loader: 'css' })` — same verification
- [x] Test names describe the prop combination and expected winner: e.g., "px:4 + pl:8 → padding-left from pl wins"

## 9. Verification (Phase 1 — split assembly)

- [x] `bun run verify:canary` — canary tests pass
- [x] `bun run verify:integration` — integration tests pass (includes new round-trip tests)
- [x] `bun run verify:showcase` — showcase build passes (assert green)
- [x] `bun run verify:vite` — vite fixture build passes (assert green)

## 10. Vite plugin — HTML-injected layer declaration

- [x] Add `transformIndexHtml` hook to the Vite plugin with `order: 'pre'`
- [x] Return `HtmlTagDescriptor` array with a single `<style>` tag: `injectTo: 'head-prepend'`, children = the `@layer` declaration string
- [x] The declaration string comes from `assembleStylesheet({ split: true }).declaration` (already computed in `buildStart`)
- [x] Store the declaration in plugin state (alongside `variableCss`, `globalCss`, etc.) so `transformIndexHtml` can access it without re-computing
- [x] Update `load()` hook — prod path: return `[variables, processedBody]` instead of `[declaration, variables, processedBody]`
- [x] Update `load()` hook — dev path: return `[variables, processedBody]` instead of `[declaration, variables, processedBody]`

## 11. Verification (Phase 2 — HTML injection)

- [x] `bun run verify:showcase` — showcase prod build: inspect `dist/index.html` for `<style>` tag containing `@layer` declaration in `<head>`
- [x] `bun run verify:vite` — vite fixture prod build: same assertion on `dist/index.html`
- [x] `bun run verify:canary` — canary tests still pass (assembleStylesheet unchanged)
- [x] `bun run verify:integration` — integration tests still pass
- [ ] Dev mode: verify `@layer` declaration appears in page source (not just virtual module CSS) — deferred to manual verification
