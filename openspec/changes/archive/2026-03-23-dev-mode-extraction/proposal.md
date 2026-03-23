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

## Resolved Questions

1. **`analyzeProject` vs per-file `extract`?** — `analyzeProject`. It's the only NAPI function that handles cross-file import resolution, extension chain provenance, topological sorting, and reconciliation. There is no viable per-file alternative. JS-level content-hash caching prevents redundant disk I/O; OXC re-parses source strings at ~1ms/file, making full re-analysis acceptable for dev.

2. **Should the `transform` hook run in dev?** — Yes, mandatory. Without it, components render via Emotion at runtime while extracted CSS sits in a @layer-structured virtual module. Emotion inline styles (highest specificity) would fight @layer base (lowest specificity), producing unpredictable double-styling. Dev and prod must use the same rendering path: createComponent shim + extracted CSS.

3. **`configPath` and module graph interaction?** — `configPath` is loaded via `execSync('bun -e ...')`, outside Vite's module graph entirely. The `handleHotUpdate` hook detects changes to the config or theme files and escalates to a "geological reset" — re-evaluating config/theme via subprocess, then running full re-extraction. Normal file changes use the incremental path (content-hash check → cached file entries → re-analysis).
