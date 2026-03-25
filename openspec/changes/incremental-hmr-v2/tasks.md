## 1. Rust: Data Structures & Traits

- [x] 1.1 Add `PartialEq` derive to `ComponentCss` and all nested types (`BaseStyles`, `VariantCss`, `StateStyles`, `Declaration`, `PseudoStyles`, `ResponsiveStyles`) in `css_generator.rs`
- [x] 1.2 Add `Clone` derive to `FileModuleInfo`, `ImportInfo`, `ExportInfo` in `import_resolver.rs` (needed for cache storage)
- [x] 1.3 Add `Clone` derive to `ChainDescriptor` and nested types in `chain_walker.rs` (needed for cache storage)
- [x] 1.4 Add `Clone` derive to `ComponentReplacement` and related types in `transform_emitter.rs` (needed for cache storage)
- [x] 1.5 Define `CachedEvalEntry` struct in `project_analyzer.rs`: `component_id: String`, `component_css: ComponentCss`, `replacement: ComponentReplacement`, `active_props: Option<HashSet<String>>`, `prop_config: Option<PropConfigMap>`
- [x] 1.6 Define `CachedFileResult` struct in `project_analyzer.rs`: `hash: String`, `module_info: FileModuleInfo`, `chains: Vec<ChainDescriptor>`, `eval_results: Vec<CachedEvalEntry>`, `jsx_usage: UsageScanResult`
- [x] 1.7 Add module-level `Mutex<HashMap<String, CachedFileResult>>` in `project_analyzer.rs` via `once_cell::sync::Lazy`

## 2. Rust: FileEntry Hash Field

- [x] 2.1 Add optional `hash: Option<String>` field to the `FileEntry` deserialization struct in `project_analyzer.rs`
- [x] 2.2 Update the JSON deserialization to accept `{ path, source, hash? }` (backward compatible — missing hash defaults to `None`)

## 3. Rust: Cache Integration in analyze()

- [x] 3.1 Add `dev_mode: bool` parameter to the internal `analyze()` function in `project_analyzer.rs`
- [x] 3.2 In Phase 1 (parse all files): before parsing each file, check `FILE_CACHE` for matching `(path, hash)`. If cache hit, use cached `module_info` and `chains` instead of parsing. If cache miss or no hash, parse via OXC as before.
- [x] 3.3 On cache hit: populate the `evaluated` working HashMap from cached `eval_results` — insert each `CachedEvalEntry` so extension merging, system_props population, and manifest generation see cached entries identically to fresh ones
- [x] 3.4 After parsing/extracting each file (cache miss), store full results in `FILE_CACHE` — module_info, chains, eval_results (pre-merge ComponentCss + ComponentReplacement), and jsx_usage
- [x] 3.5 After processing all files, evict cache entries for paths not present in the current file list (collect paths-to-evict before mutating)
- [x] 3.6 When `dev_mode` is true, Phase 5b (JSX scanning): scan ONLY changed files (cache miss). For unchanged files, reuse cached `UsageScanResult` from `CachedFileResult.jsx_usage`. Merge all scan results into usage ledger via union (additive — never remove previously-seen values).
- [x] 3.7 When `dev_mode` is true: skip Phase 5e (reconciliation). Pass all components to CSS generation without pruning. Gate the reconciliation call so it only runs when `dev_mode` is false.

## 4. Rust: NAPI Interface

- [x] 4.1 Add optional `dev_mode: Option<bool>` parameter to the `analyze_project` NAPI function in `lib.rs`
- [x] 4.2 Pass `dev_mode.unwrap_or(false)` to the internal `analyze()` function
- [x] 4.3 Add `#[napi] fn clear_analysis_cache()` function that clears the `FILE_CACHE` Mutex (for geological resets)
- [x] 4.4 Add `once_cell` to Cargo.toml dependencies

## 5. Plugin: Content Hash Passing

- [x] 5.1 Update `buildFileEntriesFromCache()` in `index.ts` to include the `hash` field from `fileCache` entries in each file entry object
- [x] 5.2 In `runAnalysis()`: pass `!isProd` (or explicit dev_mode flag) as the `dev_mode` parameter to `analyzeProject()`
- [x] 5.3 In `handleHotUpdate` geological reset path: call `clearAnalysisCache()` (new NAPI function) before `runAnalysis()`

## 6. Plugin: Dev-Mode Behavioral Changes

- [ ] 6.1 Confirm that the only-grow strategy works correctly: dev CSS should never shrink between HMR cycles (verify via dev server manual testing)
- [ ] 6.2 Verify geological reset clears the Rust cache and produces fresh full-analysis CSS (dev server manual testing after theme/system file edit)
- [ ] 6.3 Verify extension chains work correctly when parent changes but child is cached (edit parent component, confirm child's merged CSS updates)

## 7. Tests

- [x] 7.1 Canary test: call `analyzeProject()` without hashes (full analysis), then call again with same files + hashes — assert manifest matches via `serde_json::Value` structural comparison (not byte-identical, due to HashMap serialization non-determinism)
- [x] 7.2 Canary test: call `analyzeProject()` with hashes, modify one fixture's source, call again with updated hash — assert changed component's CSS reflects the edit while unchanged components' CSS is identical
- [x] 7.3 Canary test: call `analyzeProject()` with `dev_mode: true` — assert reconciliation is skipped (unused variants/states/components retained in CSS)
- [x] 7.4 Canary test: extension chain with cached parent — call with hashes, modify parent fixture only, call again — assert child's merged CSS reflects parent's changes
- [x] 7.5 Run `bun run verify` — confirm all existing tests pass with the new optional parameters
- [x] 7.6 Run `bun run verify:full` — confirm showcase build (prod mode, no caching) is unaffected
