import {
  contentHash,
  diffFilePlans,
  isPathWithinRoot,
  snapshotFilePlans,
  withoutInvalidOriginals,
} from '@animus-ui/extract/pipeline';
import { relative } from 'path';

import { VIRTUAL_BRIDGE_ID, VIRTUAL_PREFIX } from './constants';
import { buildRawEntriesFromCache, runExclusiveAnalysis } from './context';
import { invalidateFileModules } from './module-invalidation';
import { stabilizeSourceUniverse, unresolvedDropFiles } from './rediscovery';

import type { PluginContext } from './context';

/**
 * The dev-mode bridge prepend, shared with the hot-update gate so both
 * compute byte-identical served output. The import goes AFTER the directive
 * prologue the engine hoists to byte 0 — prepending above it would demote
 * 'use client'/'use strict' to an ordinary expression statement, silently
 * un-marking client modules on exactly the RSC-capable hosts this delivery
 * path serves.
 */
export function applyDevBridgeImport(code: string): string {
  const prologue = /^(?:(['"])use [a-z -]+\1;?\r?\n)*/.exec(code)?.[0] ?? '';
  return (
    prologue + `import '${VIRTUAL_BRIDGE_ID}';\n` + code.slice(prologue.length)
  );
}

/**
 * Live raw-fallback files reachable from `relPath`'s components through
 * extension provenance — the transitive closure, so a grandparent's serve is
 * withheld exactly like a direct parent's.
 */
function rawFallbackDescendants(ctx: PluginContext, relPath: string): string[] {
  const conflicted = new Set<string>();
  const queue = [...(ctx.storedManifest?.files?.[relPath] ?? [])] as string[];
  const seen = new Set(queue);
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const childId of ctx.reverseProvenance[id] ?? []) {
      if (seen.has(childId)) continue;
      seen.add(childId);
      queue.push(childId);
      // The manifest is the file authority — no id-string parsing.
      const childFile = ctx.storedManifest?.components?.[childId]?.file as
        | string
        | undefined;
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

/**
 * transform: replace builder chains with `createComponent()` calls using
 * the pre-built manifest; detect files created after buildStart and fold
 * them into the analysis.
 *
 * The HMR bridge is NOT injected here — `transformIndexHtml` delivers it as a
 * `<script type="module">` per served document (openspec:
 * dev-stylesheet-management, "HMR bridge auto-injected in dev mode"; "Transform
 * emitter unchanged" forbids the emitter importing it).
 */
export async function transformSource(
  ctx: PluginContext,
  code: string,
  id: string
): Promise<{ code: string; map: null } | null> {
  // Transform runs in both dev and prod when a manifest is available
  if (!ctx.storedManifest) return null;

  // The plugin's OWN virtual modules come back through `transform` and are not
  // source files. The components and bridge ids both satisfy the `.js`
  // extension gate on their raw text, so without this guard they reach
  // new-file detection: a `\0`-keyed `fileCache` entry no watcher event can
  // ever name (so `pruneFileCache` can never remove it) plus one full spurious
  // re-analysis each, on the very first dev page load. Both id shapes are
  // covered — `resolveVirtualId` accepts the unprefixed specifier and answers
  // with the `\0` form.
  if (id.startsWith('\0') || id.startsWith(VIRTUAL_PREFIX)) return null;

  // External DS packages bypass extension + node_modules filters —
  // published packages ship .mjs dist files with preserved builder chains.
  // Boundary-safe membership via the shared containment predicate.
  const isExternalPkg = ctx.externalPackageDirs.some((dir) =>
    isPathWithinRoot(dir, id)
  );

  const relativePath = relative(ctx.rootDir, id);

  if (!isExternalPkg) {
    // Filter by file extension (local files only)
    if (!/\.[jt]sx?$/.test(id)) return null;
    if (id.includes('node_modules')) return null;
    // A dependency resolved through a workspace symlink arrives REALPATHED —
    // no `node_modules` segment for the filter above to catch. Discovery
    // never walks beyond the root, so an out-of-root id that is not a
    // declared external package cannot be a project file (shared containment
    // predicate — covers Windows cross-drive ids too).
    if (!isPathWithinRoot(ctx.rootDir, id)) return null;
  }

  // Only process files we know about in the manifest
  if (!ctx.storedManifest.files?.[relativePath]?.length) {
    // New file detection: if this file isn't in the cache, it was created
    // after buildStart. Register it and re-run analysis to pick it up.
    // Exclusive: Vite transforms modules concurrently, and two detections
    // interleaving across the ingest awaits would publish generations built
    // from different cache snapshots — the loser's file drops out of the
    // published universe with its detection guard permanently satisfied.
    if (!ctx.isProd && !ctx.fileCache.has(relativePath)) {
      await runExclusiveAnalysis(ctx, async () => {
        // Re-check under the lock: a queued transaction may have registered
        // this file while we waited.
        if (ctx.fileCache.has(relativePath)) return;
        // A newly created EXTERNAL package file needs its ownership recorded
        // before re-analysis: the token-contract correlation joins on
        // `fileOwners[diagnostic.file]`, and an unowned file's diagnostics
        // would silently drop until the next server restart. Gated on the
        // boundary-safe membership already computed above.
        if (isExternalPkg) {
          const owner = Object.entries(ctx.externalDirOwners).find(([dir]) =>
            isPathWithinRoot(dir, id)
          );
          if (owner) ctx.externalFileOwners[relativePath] = owner[1];
        }
        const hash = contentHash(code);
        ctx.fileCache.set(relativePath, { hash, source: code });
        const prevPlans = snapshotFilePlans(ctx.storedManifest);
        let analysisOk = false;
        try {
          const ingested = await ctx.ingestRawSources(
            buildRawEntriesFromCache(ctx.fileCache)
          );
          // Per-file quarantine, buildStart parity: one invalid original
          // (this new file or any other) never aborts detection re-analysis
          // for the rest of the corpus. Strict mode still throws.
          const accepted = withoutInvalidOriginals(
            ingested,
            ctx.surfaceSourceDiagnostics(ingested.diagnostics)
          );
          analysisOk = ctx.runAnalysis(accepted.analysisEntries) !== false;
          if (analysisOk) ctx.publishSourceIngestion(accepted);
        } finally {
          // A failed analysis leaves the file UNDETECTED so the next
          // transform retries — a registered-but-unanalyzed entry would be
          // permanently hash-suppressed (openspec: dev-transform-coherence,
          // "Failed analyses do not suppress equal-content retries").
          if (!analysisOk) ctx.fileCache.delete(relativePath);
        }

        if (analysisOk) {
          // Burst creation: the detected file can itself extend a file the
          // walk has not seen (openspec: dev-transform-coherence,
          // "Source-universe reconciliation precedes unresolved-parent
          // fallbacks") — reconcile before this result is served.
          await stabilizeSourceUniverse(ctx);

          // A detection re-analysis can change OTHER served files' plans —
          // most importantly resurrecting consumers whose chains were
          // dropped while this file was undiscovered. Re-deliver them
          // before the recovery reload; the detected file itself is
          // excluded (its in-flight transform IS the current serve).
          invalidateFileModules(
            ctx,
            diffFilePlans(prevPlans, snapshotFilePlans(ctx.storedManifest), {
              exclude: relativePath,
            })
          );

          const compCount =
            ctx.storedManifest.files?.[relativePath]?.length ?? 0;
          // Standard level, not verbose-only (openspec:
          // hmr-new-file-detection, "New file detection logging").
          ctx.info(
            `New file detected: ${relativePath} — ${compCount ? `${compCount} components extracted` : 'no components'}`
          );

          // Unconditional (openspec: hmr-new-file-detection, "CSS
          // invalidation after new file analysis") — the argument is on
          // `invalidateExtractedModules` in context.ts. A usage-only file
          // (zero components of its own) still moves the system-prop map
          // and dynamic config, and a non-invalidated module is served from
          // cache for the life of the server.
          ctx.invalidateExtractedModules();
        }
      });
    }
    // Re-check after potential analysis
    if (!ctx.storedManifest.files?.[relativePath]?.length) {
      // A raw serve caused by an unresolved extension parent is recorded —
      // the barrier below withholds that parent's extracted serve while
      // this fallback is live. Any other raw serve clears the record.
      if (!ctx.isProd) {
        if (unresolvedDropFiles(ctx).has(relativePath)) {
          ctx.rawExtensionFallbacks.add(relativePath);
        } else {
          ctx.rawExtensionFallbacks.delete(relativePath);
        }
      }
      return null;
    }
  }

  // Compatibility publication barrier (openspec: dev-transform-coherence,
  // "Runtime-incompatible publications are withheld"): never successfully
  // serve an extracted extension ancestor while a descendant's live serve is
  // an unresolved-extension runtime fallback — the raw descendant would
  // execute `.extend()` against this extracted module and hit the runtime
  // guard. The conflicted descendants are re-delivered and the recovery
  // reload is scheduled BEFORE the withhold, so the failed response
  // self-clears on the next request. Deliberately OUTSIDE the try below:
  // the non-strict catch must not swallow a withheld publication.
  if (!ctx.isProd && ctx.rawExtensionFallbacks.size > 0) {
    const conflicted = rawFallbackDescendants(ctx, relativePath);
    if (conflicted.length > 0) {
      invalidateFileModules(ctx, conflicted);
      ctx.invalidateExtractedModules();
      // One-shot: the invalidation just killed the conflicting cached raw
      // transforms and this response is withheld, so the fatal pair never
      // reaches any page. Clearing here makes the trip self-limiting — a
      // consumer the reloaded page never re-imports must not withhold its
      // ancestor forever.
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

    if (!result.hasComponents) return null;

    if (ctx.verbose) {
      const compCount = ctx.storedManifest.files?.[relativePath]?.length ?? 0;
      ctx.log(`transform ${relativePath}: ${compCount} components`);
    }

    // Dev delivery rides the module graph as well as the document: every
    // component-bearing module imports the bridge, unconditionally — a
    // re-transform re-adds it, so no transform-cache invalidation can strand
    // a client, and document-rendering SSR hosts (Remix, React Router) that
    // never invoke transformIndexHtml still adopt component CSS on hydration.
    // The bridge dedupes per document behind a globalThis key and no-ops on
    // the server. Production output is exactly the engine's.
    let outputCode = result.code;
    if (!ctx.isProd) {
      outputCode = applyDevBridgeImport(result.code);
      // Presentation-only gate witness: the hash of exactly what this module
      // serves. The hot-update hook compares a post-edit re-transform against
      // it to decide whether a js-update would carry any new bytes at all.
      ctx.recordTransformOutput(relativePath, outputCode);
      // An extracted serve is never a runtime fallback.
      ctx.rawExtensionFallbacks.delete(relativePath);
    }

    return { code: outputCode, map: null };
  } catch (e) {
    if (ctx.options.strict) {
      throw new Error(`[animus-extract] Failed to transform ${id}: ${e}`, {
        cause: e,
      });
    }
    console.warn(`[animus-extract] Failed to transform ${id}:`, e);
    return null;
  }
}
