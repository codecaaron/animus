import {
  contentHash,
  diffFilePlans,
  isEngineTransformExtension,
  isPathWithinRoot,
  snapshotFilePlans,
} from '@animus-ui/extract/pipeline';
import { relative } from 'path';

import { VIRTUAL_BRIDGE_ID, VIRTUAL_PREFIX } from './constants';
import { runExclusiveAnalysis } from './context';
import { invalidateFileModules } from './module-invalidation';
import { reconcileSourceCorpus, unresolvedDropFiles } from './rediscovery';

import type { PluginContext } from './context';

/**
 * The import goes after the directive prologue: above it, 'use client'
 * becomes an ordinary expression and the module loses its client marking.
 */
export function applyDevBridgeImport(code: string): string {
  const prologue = /^(?:(['"])use [a-z -]+\1;?\r?\n)*/.exec(code)?.[0] ?? '';
  return (
    prologue + `import '${VIRTUAL_BRIDGE_ID}';\n` + code.slice(prologue.length)
  );
}

function rawFallbackDescendants(ctx: PluginContext, relPath: string): string[] {
  const manifest = ctx.storedManifest;
  const conflicted = new Set<string>();
  const queue = [...(manifest?.files[relPath] ?? [])];
  const seen = new Set(queue);
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const childId of ctx.reverseProvenance[id] ?? []) {
      if (seen.has(childId)) continue;
      seen.add(childId);
      queue.push(childId);
      // The manifest is the file authority — no id-string parsing. A missing
      // descriptor is a genuine miss, not a shape guard.
      const childFile = manifest?.components[childId]?.file;
      if (
        childFile &&
        childFile !== relPath &&
        ctx.rawExtensionFallbacks.has(childFile)
      ) {
        conflicted.add(childFile);
      }
    }
  }
  return [...conflicted].sort();
}

export async function transformSource(
  ctx: PluginContext,
  code: string,
  id: string
): Promise<{ code: string; map: null } | null> {
  if (!ctx.storedManifest) return null;

  // Virtual module ids pass the `.js` extension gate, so without this guard
  // each reaches new-file detection as a cache entry no event can remove.
  if (id.startsWith('\0') || id.startsWith(VIRTUAL_PREFIX)) return null;

  // External DS packages bypass the extension and node_modules filters:
  // published dists ship .mjs files with builder chains intact.
  const isExternalPkg = ctx.externalPackageDirs.some((dir) =>
    isPathWithinRoot(dir, id)
  );

  const relativePath = relative(ctx.rootDir, id);

  if (!isExternalPkg) {
    // The shared extension predicate is the one owner: a driver-private
    // regex drops a whole file class on one bundler family and not others.
    if (!isEngineTransformExtension(id)) return null;
    if (id.includes('node_modules')) return null;
    // A workspace symlink dependency arrives realpathed, with no
    // `node_modules` segment for the filter above to catch.
    if (!isPathWithinRoot(ctx.rootDir, id)) return null;
  }

  if (!ctx.storedManifest.files[relativePath]?.length) {
    // Exclusive: Vite transforms concurrently, and two interleaved
    // detections publish from different cache snapshots — the loser drops.
    if (!ctx.isProd && !ctx.fileCache.has(relativePath)) {
      await runExclusiveAnalysis(ctx, async () => {
        // Re-check under the lock: a queued transaction may have registered
        // this file meanwhile.
        if (ctx.fileCache.has(relativePath)) return;
        // Record ownership before re-analysis: the token-contract
        // correlation joins on the owner map, or diagnostics drop silently.
        if (isExternalPkg) {
          const owner = Object.entries(ctx.externalDirOwners).find(([dir]) =>
            isPathWithinRoot(dir, id)
          );
          if (owner) ctx.externalFileOwners[relativePath] = owner[1];
        }
        const hash = contentHash(code);
        ctx.mutateFileCache((cache) =>
          cache.set(relativePath, { hash, source: code })
        );
        const prevPlans = snapshotFilePlans(ctx.storedManifest);
        let analysisOk = false;
        try {
          analysisOk = (await ctx.analyzeIngested()).ok;
        } finally {
          // A failed analysis leaves the file undetected so the next
          // transform retries; a registered entry is hash-suppressed forever.
          if (!analysisOk) {
            ctx.mutateFileCache((cache) => cache.delete(relativePath));
          }
        }

        if (analysisOk) {
          // The detected file can itself extend a file the walk has not
          // seen, so reconcile before this result is served.
          await reconcileSourceCorpus(ctx);

          // A detection re-analysis can change other served files' plans;
          // the detected file's own in-flight transform is the current serve.
          invalidateFileModules(
            ctx,
            diffFilePlans(prevPlans, snapshotFilePlans(ctx.storedManifest), {
              exclude: relativePath,
            })
          );

          const compCount =
            ctx.storedManifest?.files[relativePath]?.length ?? 0;
          ctx.info(
            `New file detected: ${relativePath} — ${compCount ? `${compCount} components extracted` : 'no components'}`
          );

          // Unconditional: a usage-only file still moves the system-prop
          // map, and a stale module is served for the life of the server.
          ctx.invalidateExtractedModules();
        }
      });
    }
    if (!ctx.storedManifest.files[relativePath]?.length) {
      // Recording a raw serve caused by an unresolved extension parent
      // makes the barrier below withhold that parent's extracted serve.
      ctx.recordFallbackState(
        relativePath,
        unresolvedDropFiles(ctx).has(relativePath)
      );
      return null;
    }
  }

  // Never serve an extracted extension ancestor while a descendant serves
  // the raw fallback: the child `.extend()`s it and hits the runtime guard.
  if (!ctx.isProd && ctx.rawExtensionFallbacks.size > 0) {
    const conflicted = rawFallbackDescendants(ctx, relativePath);
    if (conflicted.length > 0) {
      invalidateFileModules(ctx, conflicted);
      ctx.invalidateExtractedModules();
      // One-shot, so a consumer the reloaded page never re-imports cannot
      // withhold its ancestor forever. This retires a withhold, not a serve.
      for (const file of conflicted) ctx.rawExtensionFallbacks.delete(file);
      throw new Error(
        `ANIMUS_COMPOSITION_RECOVERING: '${relativePath}' extracted while ` +
          `extension consumer(s) ${conflicted.join(', ')} are still serving ` +
          `the runtime fallback — recovering via reload; this resolves on ` +
          `the next request.`
      );
    }
  }

  try {
    const { transformFile } = ctx.engineApi();
    const result = transformFile(code, relativePath, ctx.storedManifestJson);

    if (!result.hasComponents) {
      // The manifest lists components and the engine found none: the raw
      // serve is the same fatal pair the barrier above exists to catch.
      ctx.recordFallbackState(relativePath, true);
      return null;
    }

    if (ctx.verbose) {
      const compCount = ctx.storedManifest.files[relativePath]?.length ?? 0;
      ctx.log(`transform ${relativePath}: ${compCount} components`);
    }

    // Every component-bearing dev module imports the bridge, so SSR hosts
    // that never invoke transformIndexHtml still adopt CSS on hydration.
    let outputCode = result.code;
    if (!ctx.isProd) {
      outputCode = applyDevBridgeImport(result.code);
      // The hot-update gate re-transforms after an edit and compares against
      // exactly these bytes to decide whether an update carries anything new.
      ctx.recordTransformOutput(relativePath, outputCode);
    }
    ctx.recordFallbackState(relativePath, false);

    return { code: outputCode, map: null };
  } catch (e) {
    if (ctx.options.strict) {
      throw new Error(`[animus-extract] Failed to transform ${id}: ${e}`, {
        cause: e,
      });
    }
    console.warn(`[animus-extract] Failed to transform ${id}:`, e);
    // Non-strict serves the raw source, which for an extracted file is the
    // fallback the barrier catches — recorded before returning.
    ctx.recordFallbackState(relativePath, true);
    return null;
  }
}
