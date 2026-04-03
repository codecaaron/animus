## 1. Rust Crate: Per-Component CSS Output

- [ ] 1.1 Add `ComponentCssFragments` struct with fields: `base`, `variants`, `compounds`, `states`, `custom` (all `String`)
- [ ] 1.2 In `generate_css_sheets_ordered`, collect per-component CSS fragments alongside the existing layer concatenation
- [ ] 1.3 Add `component_css: HashMap<String, ComponentCssFragments>` to `UniverseManifest`
- [ ] 1.4 Populate `component_css` during phase 6b of `analyze_project()` using the already-sorted component list
- [ ] 1.5 Verify: concatenating all component fragments per layer matches existing `CssSheets` output (canary test)

## 2. Vite Plugin: cssSplitting Option

- [ ] 2.1 Add `cssSplitting` option to `AnimusExtractOptions` interface: `boolean | { hoistThreshold?: number }` (default: `false`)
- [ ] 2.2 When disabled, behavior is identical to current single-file virtual module (no code changes in this path)
- [ ] 2.3 When enabled, parse `component_css` from manifest JSON in `buildEnd` or `generateBundle`

## 3. Vite Plugin: Global Chunk

- [ ] 3.1 When splitting enabled, virtual module (`virtual:animus/styles.css`) content becomes: declaration + variables + globals + system only (no component CSS)
- [ ] 3.2 Hoisted component CSS (above threshold) is appended to the virtual module content
- [ ] 3.3 Verify global chunk contains @layer declaration as first content

## 4. Vite Plugin: Route Chunk Emission

- [ ] 4.1 In `generateBundle` hook, inspect Rollup's output chunks to build chunk → module mapping
- [ ] 4.2 For each output chunk, determine which Animus components are in its module subgraph (match file paths from manifest `files` map)
- [ ] 4.3 Collect per-component CSS fragments for non-hoisted components in each chunk
- [ ] 4.4 Emit per-route CSS assets via `this.emitFile({ type: 'asset', fileName, source })` with component CSS wrapped in appropriate @layer blocks
- [ ] 4.5 Inject `<link>` references for route CSS assets into the corresponding JS chunks (or rely on framework-level CSS discovery)

## 5. Deduplication

- [ ] 5.1 Count component usage across output chunks — build `component_id → Set<chunk_names>` map
- [ ] 5.2 Components above hoisting threshold → add to global chunk, exclude from route chunks
- [ ] 5.3 Components in exactly one chunk → include in that route chunk
- [ ] 5.4 Components in 2+ chunks but below threshold → include in a shared chunk or the first chunk encountered (design decision to finalize)

## 6. Feasibility Validation

- [ ] 6.1 Build showcase with `cssSplitting: true`, inspect output: verify global chunk + per-route CSS files
- [ ] 6.2 Verify route chunks contain only their components' CSS (no system utilities, no theme variables)
- [ ] 6.3 Verify loading route chunks in any order produces correct rendering (manual test)
- [ ] 6.4 Measure: compare total CSS bytes (single file vs split) and initial page load CSS bytes
- [ ] 6.5 Verify `bun run verify` still passes with splitting disabled (default path unchanged)
