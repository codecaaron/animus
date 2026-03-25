## 1. Rust: Structured CSS Sheets

- [x] 1.1 Add `CssSheets` struct to `css_generator.rs` with fields: `declaration`, `base`, `variants`, `states`, `system`, `custom`
- [x] 1.2 Add `generate_css_sheets_ordered()` function that returns `CssSheets` instead of concatenated string (reuses existing `generate_layer_content_slice`)
- [x] 1.3 Add `sheets: CssSheets` field to `UniverseManifest` in `project_analyzer.rs`
- [x] 1.4 Populate `sheets` in project analyzer Phase 6b alongside existing `css` field (css = concatenation of all sheets)
- [x] 1.5 Canary test: verify manifest JSON includes `sheets` object with expected per-layer content

## 2. Plugin: Split Virtual Modules

- [x] 2.1 Add virtual module IDs for component JS module (`virtual:animus/components.js` / `\0virtual:animus/components.js`)
- [x] 2.2 Update `resolveId` to handle both `virtual:animus/styles.css` and `virtual:animus/components.js`
- [x] 2.3 Update `load` hook: in dev mode, `styles.css` serves only static CSS (layer declaration + variableCss + globalCss); in prod mode, serves everything (unchanged)
- [x] 2.4 Update `load` hook: `components.js` serves `export default \`...\`` with component CSS string (sheets.base + variants + states + system + custom)

## 3. Plugin: HMR Bridge

- [x] 3.1 Create `packages/vite-plugin/src/hmr-bridge.ts` — singleton CSSStyleSheet management, `replaceSync()`, `import.meta.hot.accept()`, fallback to `<style>` tag if Constructable StyleSheets unavailable (inlined as virtual module in load hook)
- [x] 3.2 Add `transformIndexHtml` hook to plugin: inject `<script type="module">` importing the bridge in dev mode only
- [x] 3.3 Add virtual module resolution for the bridge file (so Vite can serve it from the plugin package)

## 4. Plugin: HMR Integration

- [x] 4.1 Update `handleHotUpdate` to invalidate `virtual:animus/components.js` (instead of or alongside `virtual:animus/styles.css`) when component CSS changes
- [x] 4.2 Keep `virtual:animus/styles.css` invalidation for geological resets only (system/theme/config changes)
- [x] 4.3 Verbose logging: log which delivery mechanism is active, bridge injection confirmation

## 5. Verification

- [x] 5.1 Showcase dev server: verify adopted stylesheet appears in `document.adoptedStyleSheets`, static CSS in `<style>` tag
- [x] 5.2 Showcase dev HMR: edit a component, verify animations on other components survive the update
- [x] 5.3 Showcase prod build: verify single CSS file output identical to current behavior (`bun run verify:showcase`)
- [x] 5.4 Canary tests pass (`bun run test:canary`)
