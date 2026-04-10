## 1. Inline Built-in Transform Helpers

- [x] 1.1 Inline `percentageOrAbsolute` into `size` callback in `system/src/transforms/size.ts` — remove import from `./utils`
- [x] 1.2 Inline `numberToTemplate` into `borderShorthand` callback in `system/src/transforms/border.ts` — remove import from `./utils`
- [x] 1.3 Inline `gridItemMap` constant and `isUnitlessNumber` regex into `gridItem` callback in `system/src/transforms/grid.ts`
- [x] 1.4 Inline `repeatGridItem` and `parseGridRatio` logic into `gridItemRatio` callback — make fully self-contained
- [x] 1.5 Verify all 4 built-in transform callbacks have zero external references (no imports, no closure captures)
- [x] 1.6 Run existing transform tests to confirm output is unchanged after inlining

## 2. Rust: createTransform AST Scanner

- [x] 2.1 Add `transform_extractor.rs` to `extract/src/` — module that scans AST for `createTransform` CallExpressions
- [x] 2.2 Implement name extraction: first arg must be StringLiteral, emit diagnostic if not
- [x] 2.3 Implement callback source extraction: grab second arg span (raw source, TS stripping deferred to plugin side via esbuild/bun)
- [x] 2.4 Implement free variable validation: walk callback AST, collect all Identifier references, compare against params + locals + globals allowlist
- [x] 2.5 Emit diagnostic for external references: `[bail] Transform 'name': callback references external symbol 'symbolName'`
- [x] 2.6 Handle aliased imports: resolve `createTransform` identifier through known_bindings set passed from project_analyzer
- [x] 2.7 Add extracted transforms to `UniverseManifest`: new field `extracted_transforms: HashMap<String, String>` mapping name → JS source
- [x] 2.8 Wire scanner into `project_analyzer.rs` parse phase — runs on all files during existing AST walk
- [x] 2.9 Add canary tests for transform extraction: self-contained passes, external ref fails, aliased import resolved, dynamic name diagnostic, globals allowed

## 3. Rust: Global Styles in analyzeProject

- [x] 3.1 Add `global_style_blocks_json: Option<String>` parameter to `analyze_project` NAPI function signature
- [x] 3.2 Parse global style blocks JSON: `HashMap<String, HashMap<String, HashMap<String, Value>>>` (block → selector → prop → value)
- [x] 3.3 Resolve global style blocks using `theme_resolver::resolve_styles` — prop shorthand, scale lookup, token aliases
- [x] 3.4 Emit `__TRANSFORM__` placeholders for transform values in global styles (matching component style behavior)
- [x] 3.5 Handle `@keyframes` blocks: detect `@keyframes` selector prefix, resolve nested percentage stops using prop config
- [x] 3.6 Wrap resolved global CSS in `@layer anm-global { }` and include in manifest CSS output
- [x] 3.7 Ensure global CSS appears before component CSS in the combined output (existing layer ordering)
- [x] 3.8 Add canary tests: global style with prop shorthand, scale lookup, token alias, transform placeholder, @keyframes

## 4. Vite Plugin: Subprocess Elimination

- [x] 4.1 Modify system load subprocess script: output raw `globalStyleBlocks` JSON instead of resolved CSS; remove `transformNames` from output
- [x] 4.2 Remove global styles subprocess (subprocess 2): delete `resolve-global-styles.ts` invocation path from `loadSystem()`
- [x] 4.3 Pass raw global style blocks JSON to `analyzeProject` as new parameter
- [x] 4.4 Implement bin file generator: read extracted transforms from manifest, write zero-dep CJS resolver to temp file
- [x] 4.5 Replace subprocess 3 (transform resolution) with bin file exec: write raw CSS to temp, execute bin, read resolved CSS
- [x] 4.6 Handle no-placeholder fast path: skip bin file generation when CSS has no `__TRANSFORM__` markers
- [x] 4.7 Clean up temp files (bin file, input CSS, output CSS) after resolution — silent catch on failure
- [x] 4.8 Wire strict/non-strict error handling for bin file exec failures
- [x] 4.9 Update HMR geological reset path: re-generate bin file from fresh manifest after re-analysis
- [x] 4.10 Remove `systemResolveScript` closure variable and associated transform script writing code

## 5. Next Plugin: Parallel Changes

- [x] 5.1 Modify next-plugin `loadSystem` to output raw global style blocks, remove transform resolution subprocess
- [x] 5.2 Pass raw global style blocks to `analyzeProject` in webpack plugin
- [x] 5.3 Implement bin file resolver in next-plugin (same logic as vite-plugin — extract to shared utility if appropriate)
- [x] 5.4 Update dev watch path for bin file regeneration on re-analysis

## 6. Verification

- [x] 6.1 `bun run verify` — full TS build + test + biome check (biome pre-existing errors in showcase only)
- [x] 6.2 `bun run verify:showcase` — end-to-end extraction proof with showcase build
- [ ] 6.3 Verify showcase CSS output is identical (diff against current output)
- [ ] 6.4 Verify dev server works: HMR, geological reset, new file detection
- [x] 6.5 Verify no `resolve-global-styles` subprocess invocations remain in plugin code
- [ ] 6.6 Measure buildStart timing before/after — confirm ~200ms+ reduction
