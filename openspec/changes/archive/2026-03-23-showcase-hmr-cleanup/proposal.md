## Why

The showcase app mixes two Animus instances: the default `animus` from `@animus-ui/core` (18 components) and a custom `ds` from `custom-vocabulary.tsx` (5 components). This was an error from a previous session. The showcase should demonstrate a SINGLE custom design system end-to-end — from `createAnimus()` through extraction — proving the full workflow without relying on the default instance.

Additionally, the custom instance's grid transforms don't work correctly. `GridArrange` uses the `arrange` group (which merges the `grid` group objects), but the `cols` prop doesn't produce expected output because the transform post-processing pipeline only loads transforms from the default `@animus-ui/core` config. The custom instance's config/groupRegistry needs to be passed to the Vite plugin explicitly.

Separately, dev-mode HMR uses `full-reload` on every file change, losing React state and causing visible flicker. Vite natively supports CSS-only hot replacement — we just need to use it.

## What Changes

### Part 1: Showcase → Pure Custom Instance
- Rewrite `components.tsx` to use `ds` from `custom-vocabulary.tsx` instead of `animus` from `@animus-ui/core`
- The custom vocabulary's group definitions already cover all needed groups (surface, arrange, text, motion, space, positioning)
- Add `getExtractConfig()` export to the custom instance so the Vite plugin can load its config
- Update `vite.config.ts` to pass custom instance config/groupRegistry to `animusExtract()`
- Fix transform resolution for custom instance — the `gridItemRatio` and `borderShorthand` transforms need to resolve via the custom config path

### Part 2: CSS-Only HMR
- Replace `server.ws.send({ type: 'full-reload' })` in `handleHotUpdate` with CSS module invalidation via `server.moduleGraph.invalidateModule()`
- Add content-hash file cache (`Map<path, hash>`) to skip unchanged files during re-analysis
- Target: <50ms single-file HMR on a 100-file project

## Capabilities

### New Capabilities
- `custom-instance-extraction`: The extraction pipeline supports custom Animus instances end-to-end when config/groupRegistry are passed to the Vite plugin. Proves the `createAnimus() → addGroup() → build()` → extraction workflow.

### Modified Capabilities
- `vite-extraction-plugin`: CSS-only HMR replaces full-reload. Content-hash caching skips unchanged files. Plugin accepts custom config/groupRegistry via options.

## Impact

- **`packages/showcase/src/components.tsx`**: Rewritten to use `ds` instance
- **`packages/showcase/src/custom-vocabulary.tsx`**: Becomes the single source of truth, gains `getExtractConfig()` export
- **`packages/showcase/vite.config.ts`**: Passes custom config to `animusExtract()`
- **`packages/vite-plugin/src/index.ts`**: `handleHotUpdate` uses CSS module invalidation, content-hash cache added
- **Developer experience**: Style changes reflect instantly without losing React state
