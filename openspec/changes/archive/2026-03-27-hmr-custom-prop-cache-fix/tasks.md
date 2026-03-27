## 1. Diagnosis

- [x] 1.1 Reproduce [object Object] HMR bug with Playwright — navigate, capture baseline, trigger HMR, observe DOM
- [x] 1.2 Identify trigger: editing component DEFINITION file (Logo.tsx), not consumer file (App.tsx)
- [x] 1.3 Fetch transformed Logo.tsx from Vite dev server — observe missing `customDynamicConfig` and `logoSize` from `systemPropNames`
- [x] 1.4 Trace root cause to `project_analyzer.rs` cache-hit path — custom prop scan results not cached or restored

## 2. Fix

- [x] 2.1 Add `custom_prop_static` and `custom_prop_dynamic` fields to `CachedFileResult` struct
- [x] 2.2 Extract custom prop data from cache in Phase 1 (alongside chains, module info, eval results, jsx usage)
- [x] 2.3 Restore custom prop data in JSX scanning cache-hit path (extend `all_custom_inputs` and `all_custom_dynamic_usages`)
- [x] 2.4 Store custom prop scan results per-file during cache-miss path
- [x] 2.5 Include custom prop fields in cache storage (both cache-hit re-insert and cache-miss store)

## 3. Verification

- [x] 3.1 Build Rust crate (`bun run build:extract`)
- [x] 3.2 Restart dev server with clean Vite cache
- [x] 3.3 Verify first load works (Logo renders with correct classes and CSS variables)
- [x] 3.4 Edit Logo.tsx → HMR fires → verify Logo still renders correctly (no `[object Object]`, no DOM attribute leak)
- [x] 3.5 Run `bun run verify` — 220 tests, types clean, biome clean
