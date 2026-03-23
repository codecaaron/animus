## Why

Dev-mode extraction works (confirmed in smoke test), but `handleHotUpdate` sends `server.ws.send({ type: 'full-reload' })` — a full page reload on every file save. This loses React state, causes visible flicker, and becomes unusable as component count grows. Vite natively supports CSS-only hot replacement without page reload — we just need to use it.

Additionally, full re-analysis via `analyzeProject` on every file change is wasteful. Most files haven't changed — only the saved file's source is new. A content-hash cache would skip unchanged files, reducing HMR latency from O(all files) to O(1 file).

## What Changes

- **CSS module invalidation instead of full reload**: Replace `server.ws.send({ type: 'full-reload' })` with `server.moduleGraph.invalidateModule(cssModule)` + Vite's native CSS HMR update mechanism. The page stays loaded, React state is preserved, only the stylesheet swaps.
- **Content-hash file cache**: Store a `Map<path, contentHash>` in the plugin closure. On `handleHotUpdate`, only re-read files whose hash changed. Pass the same file entries to `analyzeProject` but skip re-reading unchanged files from disk.
- **Target latency**: <50ms for single-file HMR on a 100-file project.

## Capabilities

### Modified Capabilities
- `dev-mode-extraction`: CSS updates are hot-replaced without page reload. File content hashing skips unchanged files during re-analysis.
- `vite-extraction-plugin`: `handleHotUpdate` uses CSS module invalidation instead of full-reload.

## Impact

- **`packages/vite-plugin/src/index.ts`**: handleHotUpdate changes, content-hash cache
- **`packages/smoke-test/vite.config.ts`**: Same changes to inline plugin
- **Developer experience**: Style changes reflect instantly without losing React state
