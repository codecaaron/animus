## Why

The smoke test proves the extraction pipeline produces a working app in production builds. But development mode still falls back to Emotion runtime — the plugin is a no-op when `vite dev` runs. This means developers don't see extracted behavior during development, and any mismatch between Emotion's runtime output and the extraction pipeline's static output would only surface at build time.

More fundamentally: extraction is Emotion's replacement, not its complement. Emotion's unlayered CSS is incompatible with `@layer` ordering (the specificity trap). The two systems cannot coexist safely. Dev-mode extraction eliminates the last reason to keep Emotion in the dependency graph.

Vite's plugin API provides everything needed:
- `configureServer` — run initial analysis when the dev server starts
- `handleHotUpdate` — re-analyze when files change, update the manifest, invalidate CSS
- Plugin closure — persistent manifest storage across HMR cycles
- Native CSS HMR — Vite hot-replaces `<link>` tags automatically when CSS modules change

The extraction pipeline is fast enough for dev mode: OXC parses ~1ms/file, full analysis of a 30-file project takes <30ms. Re-analysis on each file change is instantaneous.

## What Changes

- **Vite plugin dev-mode activation**: Remove the production-only guard. The plugin runs `analyzeProject` at `configureServer` (dev) or `buildStart` (build).
- **`handleHotUpdate` hook**: When a file changes, re-read it, re-run `analyzeProject` with updated sources, update the manifest in the closure, and invalidate the CSS virtual module. Vite's HMR runtime hot-replaces the CSS.
- **Manifest as living cache**: The manifest persists in the plugin closure across the dev server lifetime. `handleHotUpdate` is the mutation point. `transform` and `load` always read from the current manifest.
- **Smoke test dev mode verification**: Run `vite dev` on the smoke test app, edit a component, verify styles update without page reload.

## Capabilities

### New Capabilities
- `dev-mode-extraction`: The Vite plugin performs extraction in development mode, maintaining a living manifest that updates on file changes via HMR. CSS updates are hot-replaced without page reload.

### Modified Capabilities
- `vite-extraction-plugin`: Remove production-only guard. Add `configureServer` hook for initial dev analysis. Add `handleHotUpdate` hook for incremental manifest updates. Manifest stored in plugin closure as persistent dev-server state.

## Impact

- **`packages/vite-plugin/src/index.ts`**: Major changes — dev mode activation, configureServer, handleHotUpdate, manifest closure pattern
- **`packages/smoke-test/vite.config.ts`**: Remove any prod-only workarounds, test HMR flow
- **Emotion becomes optional**: With dev-mode extraction, Emotion is no longer needed for development. Components render with extracted CSS in both dev and production.
- **No Rust changes**: The NAPI functions (`analyzeProject`, `transformFile`) work the same in dev and production.

## Future Hooks

- **Incremental analysis**: For large projects, re-running full `analyzeProject` on every change is wasteful. A future `updateManifest(changedFile, newSource)` NAPI function could update only the affected components. The interface (handleHotUpdate → update manifest → invalidate CSS) stays the same.
- **File watching scope**: The dev server could watch only files that contain animus chains, ignoring changes to files without extractable components.
