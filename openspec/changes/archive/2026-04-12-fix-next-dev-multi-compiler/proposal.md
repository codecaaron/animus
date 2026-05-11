## Why

Next.js 15 dev mode creates 3 webpack compilers (server, client, edge-server), each invoking the `webpack()` callback independently. This produces 3 separate `AnimusWebpackPlugin` instances. The globalThis singleton correctly deduplicates pipeline *execution* — only one instance runs `runFullPipeline()`. But instances 2/3 never hydrate system state (`variableCss`, `globalCss`, `configJson`, `fileCache` are all empty). When the initial CSS write triggers a webpack recompilation via the file watcher, those instances' `handleWatchUpdate()` sees an empty `fileCache`, treats every file as "new", and runs `runIncrementalPipeline()` with empty system data. `assembleStylesheet` produces 94 bytes (just the `@layer` declaration), overwriting the valid 11401-byte file.

The root cause is architectural: writing CSS directly to disk from per-compiler plugin instances creates a multi-writer race. StyleX (Meta) solves this with `processAssets` — CSS is injected into webpack's asset pipeline in-memory, never written to disk during dev. The disk file is a stub for module resolution only. `processAssets` fires per-compilation and reads from a module-scope shared variable, making it naturally idempotent across compilers.

## What Changes

- Move CSS delivery from disk writes to webpack's `processAssets` hook — CSS is assembled in-memory and injected into the `.animus/styles.css` asset during each compilation
- Store assembled CSS in a module-scope shared variable (all compiler instances share via Node's require cache, same pattern as StyleX)
- `.animus/styles.css` on disk becomes a stub file for webpack's initial module resolution; `processAssets` replaces its content in-memory before webpack emits anything
- Disk writes retained only for: (a) creating the initial stub, (b) triggering HMR recompilation via file watcher after CSS changes
- Edge compiler (`edge-server`) skips the plugin entirely — no CSS dependencies
- Extraction pipeline logic unchanged — only the delivery mechanism changes

## Capabilities

### New Capabilities
- `process-assets-css-delivery`: In-memory CSS delivery via webpack's `processAssets` hook, replacing disk-write delivery. Module-scope shared state ensures all compilers inject the same CSS.

### Modified Capabilities
- `next-webpack-integration`: CSS delivery changes from direct `writeFileSync` to `processAssets` asset replacement. Disk file becomes a resolution stub.
- `next-dev-hmr`: HMR trigger changes from "disk write detected by file watcher" to "targeted disk write after CSS change to trigger recompilation, with processAssets ensuring correct content."

## Impact

- **packages/next-plugin/src/singleton.ts** — Add module-scope shared CSS storage (`sharedCss` variable + getter/setter)
- **packages/next-plugin/src/plugin.ts** — Register `processAssets` hook in `apply()`, change `runFullPipeline`/`runIncrementalPipeline` to store CSS in shared variable instead of (only) writing to disk, edge compiler early-exit
- **packages/next-plugin/src/with-animus.ts** — Ensure stub `.animus/styles.css` exists at webpack config time (before compilation starts)
- **No NAPI or Rust changes** — fix is entirely in the JS plugin layer
- **No breaking changes** — consumer API unchanged
