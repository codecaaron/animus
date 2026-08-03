import { relative, resolve } from 'path';

import { buildFileEntriesFromCache, pruneFileCache } from './context';

import type { PluginContext } from './context';

/**
 * watchChange: reconcile deleted files in dev.
 *
 * `handleHotUpdate` fires for `update` events only, so a deletion never
 * reaches the HMR path. Without this hook the removed file's last-known
 * source stays in `ctx.fileCache`, and `buildFileEntriesFromCache` re-feeds
 * that ghost entry to the engine on every later re-analysis — the deleted
 * component's CSS survives for the life of the process.
 *
 * Only `delete` is handled here: `create` is already folded in at transform
 * time (new-file detection), and `update` belongs to `handleHotUpdate`.
 */
export function handleWatchChange(
  ctx: PluginContext,
  id: string,
  event: 'create' | 'update' | 'delete'
): void {
  // Only active in dev mode — the cache is only populated there.
  if (ctx.isProd || event !== 'delete') return;

  if (!pruneFileCache(ctx.fileCache, ctx.rootDir, id)) return;

  ctx.runAnalysis(buildFileEntriesFromCache(ctx.fileCache));
  ctx.log(`Deleted file pruned: ${relative(ctx.rootDir, resolve(id))}`);

  ctx.invalidateExtractedModules();
}
