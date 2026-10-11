import {
  contentHash,
  droppedExtensionMessage,
  isEngineTransformExtension,
  isPathWithinRoot,
} from '@animus-ui/extract/pipeline';
import { relative } from 'path';

import { VIRTUAL_BRIDGE_ID, VIRTUAL_PREFIX } from './constants';
import { invalidateFileModules } from './module-invalidation';
import { droppedExtensions, reconcileSourceCorpus } from './rediscovery';
import { applyPublished, changesOf, mergePublished } from './session-outcomes';

import type { ObservedOutcome, PluginContext } from './context';

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

/** The files defining a transitive extension of a component the given
 *  analysis paths define, from the published provenance. */
export function extendingFiles(
  ctx: PluginContext,
  analysisPaths: readonly string[]
): Set<string> {
  const manifest = ctx.storedManifest;
  const files = new Set<string>();
  const queue = analysisPaths.flatMap((path) => manifest?.files[path] ?? []);
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
      if (childFile) files.add(childFile);
    }
  }
  return files;
}

export async function transformSource(
  ctx: PluginContext,
  code: string,
  id: string
): Promise<{ code: string; map: null } | null> {
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

  // Aborted bytes go to the host's own parser: the retained engine would
  // serve the previous module and hide the syntax error.
  const abortedHash = ctx.abortedParseHashes.get(relativePath);
  if (abortedHash !== undefined && abortedHash === contentHash(code)) {
    return null;
  }

  // A candidate with no analysis behind it is a failure, never a raw
  // serve (SA1): the analysis failed, and serving it would ship builder code.
  if (!ctx.storedManifest) {
    throw new Error(
      `[animus-extract] no analysis is available to transform ` +
        `${relativePath}: the project analysis failed; see the error above.`
    );
  }

  let detectionFailed = false;

  if (!ctx.storedManifest.files[relativePath]?.length) {
    // A source the Session does not hold yet is submitted to it; the
    // Session serializes concurrent transforms' attempts.
    const session = ctx.session;
    if (
      !ctx.isProd &&
      session !== null &&
      !session.heldSources.has(relativePath)
    ) {
      let outcomes: ObservedOutcome[] = [];
      try {
        outcomes = await ctx.submitChanges(changesOf('create', id));
      } catch (error) {
        // A failed analysis leaves the file undetected, so the next
        // transform retries.
        ctx.warn(error instanceof Error ? error.message : String(error));
        detectionFailed = true;
      }
      if (mergePublished(outcomes).published) {
        // The detected file can itself extend a file the walk has not
        // seen, so reconcile before this result is served.
        const merged = mergePublished([
          ...outcomes,
          ...(await reconcileSourceCorpus(ctx)),
        ]);
        applyPublished(ctx, merged);

        // A detection re-analysis can change other served files' plans;
        // the detected file's own in-flight transform is the current serve.
        // A full pass has evicted them already (applyPublished).
        if (!merged.full) {
          invalidateFileModules(
            ctx,
            [...merged.planChanged].filter((path) => path !== relativePath)
          );
        }

        const compCount = ctx.storedManifest?.files[relativePath]?.length ?? 0;
        ctx.info(
          `New file detected: ${relativePath} — ${compCount ? `${compCount} components extracted` : 'no components'}`
        );

        // Unconditional: a usage-only file still moves the system-prop
        // map, and a stale module is served for the life of the server.
        ctx.invalidateExtractedModules();
      }
    }
    // A new file whose analysis failed is never served raw (SA1).
    if (detectionFailed) {
      throw new Error(
        `[animus-extract] the analysis of the new file ${relativePath} ` +
          `failed; see the error above.`
      );
    }
  }

  // An extension dropped over a parent the analysis could not resolve is
  // never served untransformed, in any mode, even beside components that
  // did extract: its builder code would render with empty classes (SA1).
  const drop = droppedExtensions(ctx).get(relativePath);
  if (drop !== undefined) throw new Error(droppedExtensionMessage(drop));
  if (!ctx.storedManifest.files[relativePath]?.length) return null;

  try {
    const { transformFile } = ctx.engineApi();
    const result = transformFile(code, relativePath, ctx.storedManifestJson);

    if (!result.hasComponents) {
      // The manifest lists components and the engine found none: serving
      // the raw source would ship builder code (SA1).
      throw new Error(
        `the analysis extracted components from ${relativePath}, but its ` +
          `transform found none`
      );
    }

    if (ctx.tracing) {
      const compCount = ctx.storedManifest.files[relativePath]?.length ?? 0;
      ctx.trace(`transform ${relativePath}: ${compCount} components`);
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

    return { code: outputCode, map: null };
  } catch (e) {
    // In every mode the failure is Vite's error, never a raw serve (SA1).
    throw new Error(`[animus-extract] Failed to transform ${id}: ${e}`, {
      cause: e,
    });
  }
}
