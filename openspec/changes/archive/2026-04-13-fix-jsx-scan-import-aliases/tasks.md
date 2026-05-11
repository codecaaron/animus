## 1. Build per-file alias augmentation in project_analyzer.rs

- [x] 1.1 In Phase 5b scan loop (before `scan_jsx_usage` call), for each file check `file_modules` for imports where `local_name != imported_name` and `imported_name` is a key in `global_component_props`, `component_usage_configs`, or `global_custom_props`
- [x] 1.2 If aliases found, clone the affected map(s) and insert alias entries (`local_name` → same prop set as `imported_name`). If no aliases, pass original maps unchanged.
- [x] 1.3 Pass the augmented maps to `scan_jsx_usage` and `scan_jsx` (custom props) for that file
- [x] 1.4 Apply same alias resolution to the cache-hit path — when restoring cached usage from a file with aliases, the cached results should still be valid (cache key is content hash, aliases are stable for same content)

## 2. Fix incremental dev_mode flag

- [x] 2.1 In `runIncrementalPipeline()`, change `dev_mode` parameter from `false` to `true` so Rust analyzer reuses cached JSX usage for unchanged files (empty source) instead of re-parsing empty ASTs
- [x] 2.2 Rebuild next-plugin — confirm no TS errors

## 3. Verify

- [x] 3.1 Build the extract crate (`napi build --platform --release` from packages/extract) — confirm no compile errors
- [x] 3.2 Run canary tests (`bun run test:canary`) — confirm no regressions
