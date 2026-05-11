## 1. Bug Fix + Dead Code Cleanup

- [x] 1.1 Fix next-plugin selectorAliases/selectorOrder — add class fields, capture from `loadSystemModule()`, pass to `analyzeProject()` instead of `null, null`
- [x] 1.2 Delete `packages/extract/pipeline/subprocess.ts`
- [x] 1.3 Remove `execSubprocess` and `detectRuntime` re-exports from `packages/extract/pipeline/index.ts`
- [x] 1.4 Delete `packages/vite-plugin/src/resolve-global-styles.ts`
- [x] 1.5 Update 5 stale subprocess comments in `packages/vite-plugin/src/index.ts` (lines 22, 350, 352, 419, 430)
- [x] 1.6 Update 3 stale subprocess comments in `packages/next-plugin/src/plugin.ts` (lines 45, 281, 428)
- [x] 1.7 Run `bun run verify` — confirm no regressions from cleanup

## 2. Rust: Per-Component Fragment Generation

- [x] 2.1 Add `PerComponentSheets` struct to `css_generator.rs` with `base`, `variants`, `compounds`, `states` as `Option<String>` fields, `#[serde(skip_serializing_if)]`
- [x] 2.2 Add `CssFragmentStore` struct with 4 `Vec<(String, String)>` fields + 4 `FxHashMap<String, usize>` side indexes + cumulative byte counters
- [x] 2.3 Refactor `generate_css_sheets_ordered()` to single-pass: iterate components once, produce fragments for all 4 layers simultaneously, populate `CssFragmentStore`
- [x] 2.4 Derive `CssSheets` from `CssFragmentStore` via pre-allocated fold — `String::with_capacity(total_bytes)` per layer
- [x] 2.5 Add fragment equality test: assert concatenated fragments == existing CssSheets output for showcase build
- [x] 2.6 Run `bun run test:canary` — all Rust tests pass with refactored generation

## 3. Rust: Manifest Integration

- [x] 3.1 Add `component_fragments: HashMap<String, PerComponentSheets>` field to `UniverseManifest`
- [x] 3.2 Build `component_fragments` from `CssFragmentStore` during manifest construction in `project_analyzer.rs`
- [x] 3.3 Build `reverse_provenance: HashMap<String, Vec<String>>` from existing `provenance` map (invert child→ancestors to parent→children)
- [x] 3.4 Add `reverse_provenance` field to `UniverseManifest` serialization
- [x] 3.5 Add canary test: verify `component_fragments` presence and non-empty for showcase build
- [x] 3.6 Add canary test: verify `reverse_provenance` contains expected parent→child entries for extension chain fixtures

## 4. Vite Plugin: Fragment Consumption + HMR Splice

- [x] 4.1 Parse `component_fragments` from manifest JSON into local fragment cache (`Map<string, PerComponentSheets>`)
- [x] 4.2 Parse `reverse_provenance` from manifest JSON
- [x] 4.3 On HMR file change: identify changed file's component_ids via `manifest.files[relPath]`, compute transitive invalidation set via `reverse_provenance` BFS, flag affected layers
- [x] 4.4 After re-analysis: update only invalidated component_ids in local fragment cache, re-concatenate only affected layer strings
- [x] 4.5 Verify: dev server HMR correctly updates CSS when a single component file changes

## 5. Next Plugin: Selector Aliases + Incremental HMR

- [x] 5.1 Add `selectorAliasesJson` and `selectorOrderJson` fields to `AnimusWebpackPlugin` class
- [x] 5.2 Capture from `loadSystemModule()` output in `loadSystem()` method
- [x] 5.3 Pass to `analyzeProject()` instead of `null, null`
- [x] 5.4 Refactor `handleWatchUpdate()` to use `buildFileEntriesFromCache` pattern — send empty source for unchanged files
- [x] 5.5 Extract `buildFileEntriesFromCache` helper (or import shared utility) for constructing cache-aware file entries

## 6. Documentation Updates

- [x] 6.1 Rewrite vite-plugin CLAUDE.md "Subprocess Model" section — describe NAPI `loadSystemModule()` and in-process transform/global styles resolution
- [x] 6.2 Rewrite vite-plugin CLAUDE.md "Plugin Lifecycle" sections 1 and 3 — remove subprocess references
- [x] 6.3 Add `loadSystemModule` to extract CLAUDE.md "NAPI Functions" section
- [x] 6.4 Update extract CLAUDE.md to reflect `component_fragments` and `reverse_provenance` in manifest

## 7. Verification

- [x] 7.1 `bun run verify` — full TS build + test + biome check
- [x] 7.2 `bun run test:canary` — all Rust tests including new fragment tests
- [x] 7.3 `bun run verify:showcase` — end-to-end extraction proof with showcase build
- [x] 7.4 Verify dev server works: HMR, geological reset, new file detection
- [x] 7.5 Verify showcase CSS output unchanged (fragment concatenation matches previous monolithic output)
