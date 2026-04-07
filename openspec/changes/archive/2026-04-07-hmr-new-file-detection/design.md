## Context

The Vite plugin's file registry is built once at `buildStart` via filesystem walk — the "geological survey." This populates `fileCache` (a `Map<string, { hash, source }>`) which is the source of truth for which files exist in the project. New files created during dev are never added to this map.

The existing HMR path (`handleHotUpdate`) already handles re-analysis gracefully: it updates `fileCache`, calls `buildFileEntriesFromCache()`, and re-runs `analyzeProject()`. But it only fires for files already in Vite's module graph. A new file's first contact with the plugin is via the `transform` hook, which gates on `storedManifest.files?.[relativePath]?.length` — if the file was never analyzed, transform returns `null` and the builder chain passes through as raw JS.

The Rust crate's `analyzeProject()` is synchronous (NAPI) and has per-file caching (MD5-keyed). Re-running it after adding one new file to `fileCache` is cheap — only the new file is parsed via OXC, everything else is a cache hit.

## Goals / Non-Goals

**Goals:**
- Files created during `vite dev` are extracted and styled on first render (no restart required)
- The fix is contained to the JS plugin layer — no Rust crate changes
- Existing file change detection and HMR remain unchanged
- New-file detection is logged for debugging visibility

**Non-Goals:**
- File deletion detection (stale `fileCache` entries for deleted files — pre-existing, separate concern)
- Filesystem watchers or polling (Vite already watches; we intercept at transform time)
- Incremental single-file NAPI API (full `analyzeProject()` with per-file cache is already fast enough)
- Handling files that don't contain animus builder chains (they pass through `runAnalysis` harmlessly — Rust finds nothing, manifest has no entry, transform returns null)

## Decisions

### 1. Transform hook as the detection point

The `transform` hook is the natural place to detect new files. It's the first plugin hook called for a newly-imported file, and it already receives the source code as its first argument (no filesystem read needed).

**Alternative considered:** `handleHotUpdate` — but this only fires for files already in Vite's module graph. A brand new file imported for the first time has no module graph entry when the *importing* file triggers HMR.

**Alternative considered:** `resolveId` — fires earlier, but doesn't have the source code and is the wrong semantic (resolution, not analysis).

### 2. Synchronous re-analysis within transform

When transform detects a new file (not in `fileCache`), it:
1. Computes the content hash and adds the file to `fileCache`
2. Calls `buildFileEntriesFromCache()` to build the full file list
3. Calls `runAnalysis()` synchronously — updates `storedManifest` in place
4. Re-checks `storedManifest.files` and transforms if the file now has components

This is safe because `runAnalysis()` is synchronous (NAPI call) and the Rust cache means only the new file is actually parsed. Worst case for a 50-file project: ~2ms for the new file parse + ~1ms for cache-hit traversal of the other 49 files.

**Alternative considered:** Deferred analysis (set a flag, analyze on next HMR cycle) — but this means the first render is always unstyled, defeating the purpose.

### 3. configureServer hook for CSS invalidation

After re-analysis in the transform hook, the component CSS virtual module contains stale content. To deliver the new CSS immediately, the plugin needs to invalidate `virtual:animus/components.js` and send an HMR update.

A `configureServer` hook stores the dev server reference in the plugin closure. The transform hook uses it to invalidate and trigger an HMR update for the component CSS module after new-file analysis.

**Alternative considered:** No invalidation (wait for next natural HMR cycle) — acceptable fallback but degrades DX. The component would render unstyled for the brief window between first import and next file save.

**Trade-off:** The HMR update for the CSS module triggers after transform returns. Vite's HMR pipeline processes the invalidation asynchronously, so the first transform result returns the correctly transformed JS (with `createComponent()` calls), and the CSS arrives via the adopted stylesheet moments later. In practice this is imperceptible.

### 4. Guard: only trigger for genuinely new files

The detection ONLY fires when `!fileCache.has(relativePath)`. Files already in the cache that simply aren't in the manifest (e.g., files with no builder chains) do NOT trigger re-analysis on every transform call. This is important — without this guard, every non-component file would trigger a redundant analysis on every HMR cycle.

After the first detection and analysis, the file is in `fileCache`. Subsequent changes go through the normal `handleHotUpdate` path.

## Risks / Trade-offs

**[Risk] Multiple new files imported simultaneously** → Each triggers its own transform → analysis cycle sequentially. The Rust cache means only the first analysis is expensive (relatively — still <5ms). Subsequent ones skip already-cached files. Acceptable for the dev-time use case.

**[Risk] Non-component file triggers one unnecessary analysis** → A new `.tsx` file with no builder chains gets added to `fileCache`, triggers `runAnalysis()`, Rust finds nothing. The file is now in the cache, so this only happens once per file. Cost: one ~3ms analysis. No ongoing overhead.

**[Risk] Transform returns before CSS arrives** → The first render may flash unstyled for a frame until the HMR update delivers the adopted stylesheet. This is the same behavior as any other HMR CSS update and is imperceptible in practice.

**[Risk] File deletion leaves stale cache entries** → Pre-existing issue, not introduced by this change. `fileCache` never evicts entries for deleted files. The Rust cache returns stale data for them. Flagged as a separate concern.
