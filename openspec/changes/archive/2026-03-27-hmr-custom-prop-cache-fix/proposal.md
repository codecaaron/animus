## Why

Custom props defined via `.props()` break on HMR when the component definition file is edited. The responsive object `{ _: 'md', md: 'xxl' }` renders as `[object Object]` after any HMR update to the defining file. Static string values also break — they leak to the DOM as HTML attributes instead of being intercepted by the system prop resolution path.

This is a high-priority bug because it breaks every component using `.props()` during development, requiring a full page refresh after any edit to a component file.

## Root Cause

The Rust per-file extraction cache (`CachedFileResult` in `project_analyzer.rs`) caches JSX usage scan results for unchanged files during incremental HMR analysis. However, custom prop scan results — produced by a separate `scan_jsx()` call — were NOT included in the cache.

When a component definition file changes on HMR:
1. Consumer files (e.g., `App.tsx`) are cache hits — their source is not re-scanned
2. The cache-hit path restored `system_prop_usages` but skipped custom prop usages entirely
3. `all_custom_dynamic_usages` was empty → `per_component_custom_dynamic` was empty
4. Component's `custom_dynamic_config` was `None` → no scale/transform resolution
5. Custom prop names were missing from `systemPropNames` → `filterProps` didn't include them
6. Props leaked to DOM as HTML attributes → React stringified objects as `[object Object]`

## What Changes

- **`CachedFileResult`** gains two new fields: `custom_prop_static: Vec<SystemPropUsage>` and `custom_prop_dynamic: Vec<DynamicPropUsage>`
- **Phase 1 (cache extraction)**: custom prop data is extracted alongside existing cached fields
- **JSX scanning cache-hit path**: restores `all_custom_inputs` and `all_custom_dynamic_usages` from cache
- **JSX scanning cache-miss path**: stores custom prop results per-file for cache storage
- **Cache storage**: both cache-hit re-insert and cache-miss store include custom prop fields

## Impact

- **packages/extract/src/project_analyzer.rs** — `CachedFileResult` struct, Phase 1 cache extraction, JSX scanning cache-hit/miss paths, cache storage

No changes to the vite plugin, runtime, or TypeScript surface. The fix is entirely within the Rust extraction cache.

## Verification

Reproduced via Playwright:
1. Start showcase dev server
2. Navigate to page — Logo renders correctly with slot classes and CSS variables
3. Edit `Logo.tsx` (component definition) → HMR fires
4. **Before fix**: `<h1 logosize="[object Object]">` — prop leaked to DOM
5. **After fix**: `<h1 class="animus-Logo-... animus-dyn-..." style="--animus-logo-size: 64px; ...">` — correct
