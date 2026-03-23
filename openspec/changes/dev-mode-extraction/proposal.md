## Why

The Vite plugin skips extraction entirely in dev mode (`if (!isProd) return` at buildStart). The showcase only works via `vite build` — `vite dev` serves theme CSS variables but no component styles. This means no live development workflow for extracted components.

Three things need to happen:

1. **Enable extraction in dev mode.** The same `analyzeProject` pipeline that runs at build time should run at dev server start, populating the virtual CSS module with component styles.

2. **CSS-only HMR.** When a file changes, re-extract and update the virtual CSS module without a full page reload. Use `server.moduleGraph.invalidateModule()` + Vite's native CSS HMR. React state is preserved.

3. **Content-hash file cache.** Only re-read changed files on HMR. Cache file entries by content hash. Pass the full array to `analyzeProject` but skip disk I/O for unchanged files. Target: <50ms single-file HMR on a 100-file project.

## What Changes

- Remove `if (!isProd) return` guard in `buildStart` — run full extraction pipeline in both dev and prod
- Add `configureServer` hook to store the Vite dev server reference
- Add `handleHotUpdate` hook that re-runs extraction on file changes, invalidates the CSS virtual module, and returns it for CSS-only HMR
- Add `Map<string, { hash: string; source: string }>` file cache in the plugin closure
- The `configPath` option (added in showcase-hmr-cleanup) must work in dev mode too

## Capabilities

### Modified Capabilities
- `vite-extraction-plugin`: Dev mode runs full extraction. HMR uses CSS module invalidation instead of full reload. Content-hash caching skips unchanged files.

## Impact

- **`packages/vite-plugin/src/index.ts`**: `buildStart` runs in dev, new `configureServer` + `handleHotUpdate` hooks, file cache
- **`packages/showcase/`**: `bun run dev` becomes a working development workflow
- **Developer experience**: Edit a component → styles update instantly → React state preserved

## Open Questions

- Should dev mode use `analyzeProject` (whole-project, slower but handles cross-file extension) or per-file `extract` (faster but misses extensions)? Likely `analyzeProject` with caching makes the per-file cost negligible.
- Should the `transform` hook also run in dev mode (source replacement with createComponent shim), or only the CSS extraction? If `transform` is skipped, components render via Emotion at runtime but styles come from extraction — potential cascade conflict with @layer.
- How does the `configPath` bun subprocess interact with Vite's module graph? Changes to the config module itself should trigger a full re-extraction.
