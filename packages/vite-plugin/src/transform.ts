import { contentHash } from '@animus-ui/extract/pipeline';
import { isAbsolute, relative, sep } from 'path';

import { VIRTUAL_BRIDGE_ID, VIRTUAL_PREFIX } from './constants';
import { buildFileEntriesFromCache } from './context';

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
 * transform: replace builder chains with `createComponent()` calls using
 * the pre-built manifest; detect files created after buildStart and fold
 * them into the analysis.
 *
 * The HMR bridge is NOT injected here — `transformIndexHtml` delivers it as a
 * `<script type="module">` per served document (openspec:
 * dev-stylesheet-management, "HMR bridge auto-injected in dev mode"; "Transform
 * emitter unchanged" forbids the emitter importing it).
 */
export function transformSource(
  ctx: PluginContext,
  code: string,
  id: string
): { code: string; map: null } | null {
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
  // Boundary-safe match: `/pkgs/ui` must not claim `/pkgs/ui-icons/*`.
  const isExternalPkg = ctx.externalPackageDirs.some(
    (dir) => id.startsWith(dir + sep) || id === dir
  );

  const relativePath = relative(ctx.rootDir, id);

  if (!isExternalPkg) {
    // Filter by file extension (local files only)
    if (!/\.[jt]sx?$/.test(id)) return null;
    if (id.includes('node_modules')) return null;
    // A dependency resolved through a workspace symlink arrives REALPATHED —
    // no `node_modules` segment for the filter above to catch. Discovery
    // never walks beyond the root, so an out-of-root id that is not a
    // declared external package cannot be a project file; folding it into
    // new-file detection would spuriously re-analyze, invalidate both
    // virtual modules, and full-reload on its first dev request.
    // (`isAbsolute`: on Windows a cross-drive `relative()` stays absolute.)
    if (relativePath.startsWith('..') || isAbsolute(relativePath)) return null;
  }

  // Only process files we know about in the manifest
  if (!ctx.storedManifest.files?.[relativePath]?.length) {
    // New file detection: if this file isn't in the cache, it was created
    // after buildStart. Register it and re-run analysis to pick it up.
    if (!ctx.isProd && !ctx.fileCache.has(relativePath)) {
      // A newly created EXTERNAL package file needs its ownership recorded
      // before re-analysis: the token-contract correlation joins on
      // `fileOwners[diagnostic.file]`, and an unowned file's diagnostics
      // would silently drop until the next server restart. Gated on the
      // boundary-safe membership already computed above.
      if (isExternalPkg) {
        const owner = Object.entries(ctx.externalDirOwners).find(
          ([dir]) => id === dir || id.startsWith(dir + sep)
        );
        if (owner) ctx.externalFileOwners[relativePath] = owner[1];
      }
      const hash = contentHash(code);
      ctx.fileCache.set(relativePath, { hash, source: code });
      const fileEntries = buildFileEntriesFromCache(
        ctx.fileCache,
        relativePath
      );
      ctx.runAnalysis(fileEntries);

      const compCount = ctx.storedManifest.files?.[relativePath]?.length ?? 0;
      // Standard level, not verbose-only (openspec: hmr-new-file-detection,
      // "New file detection logging").
      ctx.info(
        `New file detected: ${relativePath} — ${compCount ? `${compCount} components extracted` : 'no components'}`
      );

      // Unconditional (openspec: hmr-new-file-detection, "CSS invalidation
      // after new file analysis") — the argument is on
      // `invalidateExtractedModules` in context.ts. A usage-only file (zero
      // components of its own) still moves the system-prop map and dynamic
      // config, and a non-invalidated module is served from cache for the
      // life of the server.
      ctx.invalidateExtractedModules();
    }
    // Re-check after potential analysis
    if (!ctx.storedManifest.files?.[relativePath]?.length) return null;
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
