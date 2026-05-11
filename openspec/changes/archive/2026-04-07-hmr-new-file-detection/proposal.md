## Why

Files created during `vite dev` are invisible to the extraction pipeline. The `buildStart` hook scans the filesystem once (the "geological survey") and populates `fileCache` — new files aren't in that cache, so they never reach `analyzeProject()`. The component renders as an unstyled element until the dev server is restarted. This is the most common DX friction point during active development.

## What Changes

- **Transform-time new file detection**: The `transform` hook becomes the "immigration checkpoint" — when it encounters a file not in `fileCache`, it registers it and re-runs analysis synchronously before transforming. The Rust crate's per-file cache makes this cheap: only the new file is parsed, everything else is a cache hit.
- **Dev server reference for CSS invalidation**: A `configureServer` hook stores the dev server reference so `transform` can invalidate the component CSS virtual module after new-file analysis. Without this, styles wouldn't appear until the next HMR cycle.
- **Logging**: New-file detection events are logged at the standard verbosity level for debugging visibility.

## Capabilities

### New Capabilities
- `hmr-new-file-detection`: The Vite plugin detects files created after `buildStart` during dev mode. When `transform` encounters an unknown file, it adds the file to the analysis set, re-runs extraction, invalidates the component CSS module, and transforms the file — all synchronously within the same transform call.

### Modified Capabilities
- `vite-extraction-plugin`: The `transform` hook gains a new-file detection path. A `configureServer` hook is added to store the dev server reference. No behavioral changes to existing files — the new path only activates for files absent from `fileCache`.

## Impact

- **`packages/vite-plugin/src/index.ts`**: ~20 lines added — `configureServer` hook (3 lines), transform checkpoint logic (15 lines), one log call.
- **No Rust changes**: The NAPI functions and per-file cache work as-is. `analyzeProject()` already handles new entries in the file list gracefully.
- **No new dependencies**: Uses existing `contentHash`, `buildFileEntriesFromCache`, `runAnalysis` internals.
- **No breaking changes**: Existing files follow the same path. The new detection is additive.
