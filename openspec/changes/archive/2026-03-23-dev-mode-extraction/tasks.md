## 1. Remove isProd gates

- [x] 1.1 Remove `if (!isProd) return` guard at line 285 of `buildStart` in `packages/vite-plugin/src/index.ts` — extraction pipeline now runs in both dev and prod
- [x] 1.2 Change `transform` hook guard from `if (!isProd || !storedManifest)` to `if (!storedManifest)` — source replacement active in both modes
- [x] 1.3 Verify `bun run test:canary` still passes (no behavioral change for prod builds)

## 2. File cache infrastructure

- [x] 2.1 Add `fileCache: Map<string, { hash: string; source: string }>` to the plugin closure alongside existing state variables
- [x] 2.2 Add `createHash` import from `crypto` (Node built-in, no new dependency)
- [x] 2.3 After file discovery + reading in `buildStart`, populate the file cache with MD5 hash + source for each file entry
- [x] 2.4 Add helper function `buildFileEntriesFromCache(fileCache): Array<{ path: string; source: string }>` that reconstructs the file entries array from cache

## 3. Dev server integration

- [x] 3.1 Add `server: ViteDevServer | null` to plugin closure state
- [x] 3.2 Add `configureServer` hook that stores the server reference
- [x] 3.3 Track resolved config and theme file paths in plugin closure for geological reset detection (`resolvedConfigPath`, `resolvedThemePath`)

## 4. handleHotUpdate hook

- [x] 4.1 Add `handleHotUpdate` hook skeleton with file relevance check (extension filter + exclude pattern filter)
- [x] 4.2 Implement content-hash check: read changed file, compute MD5, compare to cache — return early if unchanged
- [x] 4.3 Implement geological reset path: detect config/theme file changes, re-evaluate via bun subprocess, update `themeJson`/`configJson`/`groupRegistryJson`/`variableCss`
- [x] 4.4 Implement diurnal path: update cache entry for changed file, rebuild file entries from cache, re-run package discovery (reuse existing logic), call `analyzeProject`
- [x] 4.5 Apply transform post-processing to new manifest CSS (same bun subprocess mechanism as `load` hook) — store resolved CSS so `load` serves it directly
- [x] 4.6 Update `storedManifest` and `storedManifestJson` with new analysis results
- [x] 4.7 Invalidate virtual CSS module via `server.moduleGraph.getModuleById(RESOLVED_CSS_ID)` + `server.moduleGraph.invalidateModule()`
- [x] 4.8 Return the CSS module in the HMR array to trigger Vite's native CSS HMR

## 5. Refactor shared extraction logic

- [x] 5.1 Extract the file discovery + reading + package resolution + `analyzeProject` call into a reusable function (shared between `buildStart` and `handleHotUpdate`) to avoid code duplication
- [x] 5.2 Extract transform post-processing (bun subprocess for `__TRANSFORM__` placeholders) into a standalone function callable from both `load` and `handleHotUpdate`

## 6. Showcase dev mode verification

- [x] 6.1 Run `bun run dev` in `packages/showcase/` — verify the page renders with extracted component styles (not just theme variables)
- [x] 6.2 Edit a style value in `packages/showcase/src/components.tsx` — verify CSS updates without full page reload (React state preserved)
- [x] 6.3 Edit the theme file `packages/showcase/src/theme.ts` — verify geological reset (full re-extraction, styles update)
- [x] 6.4 Verify `bun run test:showcase` (production build) still passes

## 7. Verify pipeline

- [x] 7.1 Run `bun run verify` — full build + test + lint passes
- [x] 7.2 Update canary test snapshot if CSS output changed (dev-mode extraction shouldn't change prod output, but verify)
