# Tasks: fix-next-dev-multi-compiler

## 1. Shared CSS storage in singleton

- [x] 1.1 Add `getSharedCss()` / `setSharedCss()` to `singleton.ts` using a `globalThis` key (same pattern as existing `MANIFEST_KEY`)
- [x] 1.2 Add `getSharedSystemProps()` / `setSharedSystemProps()` for the system-props.js content (also written per-pipeline, same race risk)

## 2. processAssets hook registration

- [x] 2.1 Add `name?: string` to the local `Compiler` type in plugin.ts, and add `compilation` type with `hooks.processAssets.tap`, `updateAsset`, `getAsset` (minimal typing needed)
- [x] 2.2 In `apply()`, register `compiler.hooks.compilation.tap` → inside, register `compilation.hooks.processAssets.tap` at `PROCESS_ASSETS_STAGE_ADDITIONAL` that reads `getSharedCss()` and replaces the `.animus/styles.css` asset if shared CSS is non-empty
- [x] 2.3 In `apply()`, skip all hook registration if `compiler.options?.name === 'edge-server'`

## 3. Pipeline stores CSS in shared variable

- [x] 3.1 In `runFullPipeline()`, after assembling `fullCss`, call `setSharedCss(fullCss)` and `setSharedSystemProps(systemPropsContent)` — these become the authoritative source
- [x] 3.2 In `runFullPipeline()`, retain the disk write but guard it: only write if this is the instance that ran the pipeline (the singleton promise owner). The disk write serves as HMR trigger only.
- [x] 3.3 In `runIncrementalPipeline()`, same pattern: `setSharedCss(fullCss)`, disk write for HMR trigger only

## 4. Stub file creation

- [x] 4.1 In `with-animus.ts`, ensure `.animus/styles.css` exists before webpack compilation starts — write the `@layer` declaration stub if file doesn't exist. Move this BEFORE plugin instantiation so the file is resolvable during module resolution.

## 5. Remove non-owner pipeline execution

- [x] 5.1 In `handleWatchUpdate()`, add early return if `this.configJson === ''` (system state never loaded) — non-owning instances that somehow enter this path skip instead of running incremental pipeline with empty state
- [x] 5.2 Keep existing singleton promise dedup for initial run — instances that await the promise don't need state hydration anymore since processAssets reads from the shared variable

## 6. Verification

- [x] 6.1 `next build` in next-test-app — production path produces full CSS output
- [x] 6.2 `next dev` in next-test-app — dev mode produces full CSS, not just layer declaration
- [x] 6.3 Verify timing output shows one full pipeline run (no spurious 0ms `total` lines)
- [x] 6.4 `bun test` — existing test suite passes
