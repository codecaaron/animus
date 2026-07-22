import { contentHash } from '@animus-ui/extract/pipeline';
import { relative, sep } from 'path';

import {
  RESOLVED_COMPONENTS_ID,
  RESOLVED_SYSTEM_PROPS_ID,
  VIRTUAL_BRIDGE_ID,
} from './constants';
import { buildFileEntriesFromCache } from './context';

import type { PluginContext } from './context';

/**
 * transform: replace builder chains with `createComponent()` calls using
 * the pre-built manifest; inject the HMR bridge import once in dev; detect
 * files created after buildStart and fold them into the analysis.
 */
export function transformSource(
  ctx: PluginContext,
  code: string,
  id: string
): { code: string; map: null } | null {
  // Transform runs in both dev and prod when a manifest is available
  if (!ctx.storedManifest) return null;

  // External DS packages bypass extension + node_modules filters —
  // published packages ship .mjs dist files with preserved builder chains.
  // Boundary-safe match: `/pkgs/ui` must not claim `/pkgs/ui-icons/*`.
  const isExternalPkg = ctx.externalPackageDirs.some(
    (dir) => id.startsWith(dir + sep) || id === dir
  );

  if (!isExternalPkg) {
    // Filter by file extension (local files only)
    if (!/\.[jt]sx?$/.test(id)) return null;
    if (id.includes('node_modules')) return null;
  }

  // Only process files we know about in the manifest
  const relativePath = relative(ctx.rootDir, id);
  if (!ctx.storedManifest.files?.[relativePath]?.length) {
    // New file detection: if this file isn't in the cache, it was created
    // after buildStart. Register it and re-run analysis to pick it up.
    if (!ctx.isProd && !ctx.fileCache.has(relativePath)) {
      const hash = contentHash(code);
      ctx.fileCache.set(relativePath, { hash, source: code });
      const fileEntries = buildFileEntriesFromCache(
        ctx.fileCache,
        relativePath
      );
      ctx.runAnalysis(fileEntries);

      const compCount = ctx.storedManifest.files?.[relativePath]?.length ?? 0;
      ctx.log(
        `New file detected: ${relativePath} — ${compCount ? `${compCount} components extracted` : 'no components'}`
      );

      // Invalidate component CSS so adopted stylesheet picks up new styles
      if (compCount && ctx.devServer) {
        const compModule = ctx.devServer.moduleGraph.getModuleById(
          RESOLVED_COMPONENTS_ID
        );
        if (compModule) {
          ctx.devServer.moduleGraph.invalidateModule(compModule);
        }
        const sysPropModule = ctx.devServer.moduleGraph.getModuleById(
          RESOLVED_SYSTEM_PROPS_ID
        );
        if (sysPropModule) {
          ctx.devServer.moduleGraph.invalidateModule(sysPropModule);
        }
        // New file detection is rare (creating a component during dev).
        // Reload is the most reliable way to deliver the new CSS —
        // virtual module HMR path matching is fragile for programmatic sends.
        // Guarded: the server may have been torn down inside the delay.
        setTimeout(() => {
          ctx.devServer?.hot?.send({ type: 'full-reload' });
        }, 100);
      }
    }
    // Re-check after potential analysis
    if (!ctx.storedManifest.files?.[relativePath]?.length) return null;
  }

  try {
    const { transformFile } = ctx.engineApi();
    const result = transformFile(code, relativePath, ctx.storedManifestJson);

    if (!result.hasComponents) return null;

    let transformedCode = result.code;

    // In dev mode, inject the HMR bridge import into the first transformed file.
    // This ensures the adopted stylesheet is created before any component renders.
    if (!ctx.isProd && !ctx.bridgeInjected && ctx.storedSheets) {
      transformedCode = `import '${VIRTUAL_BRIDGE_ID}';\n${transformedCode}`;
      ctx.bridgeInjected = true;
      ctx.log('HMR bridge injected via transform');
    }

    if (ctx.verbose) {
      const compCount = ctx.storedManifest.files?.[relativePath]?.length ?? 0;
      ctx.log(`transform ${relativePath}: ${compCount} components`);
    }

    return { code: transformedCode, map: null };
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
