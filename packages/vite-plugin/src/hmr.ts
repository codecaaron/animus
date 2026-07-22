import {
  clearEngineCache,
  contentHash,
  preprocessMdx,
} from '@animus-ui/extract/pipeline';
import { readFileSync } from 'fs';
import { extname, relative, resolve, sep } from 'path';

import {
  DEFAULT_EXCLUDE,
  RESOLVED_COMPONENTS_ID,
  RESOLVED_CSS_ID,
  RESOLVED_SYSTEM_PROPS_ID,
} from './constants';
import { buildFileEntriesFromCache } from './context';

import type { PluginContext } from './context';
import type { HmrContext, ModuleNode } from 'vite';

/**
 * handleHotUpdate: content-hash diffing, geological reset on system-file
 * change, incremental re-analysis, and targeted module invalidation
 * (component CSS, system props, and definition files whose replacement
 * changed).
 */
export async function handleHotUpdate(
  ctx: PluginContext,
  { file, server: hmrServer, modules }: HmrContext
): Promise<ModuleNode[] | void> {
  // Only active in dev mode
  if (ctx.isProd) return;

  const ext = extname(file);
  if (!ctx.extensionsSet.has(ext)) return;

  const excludePatterns = ctx.options.exclude ?? DEFAULT_EXCLUDE;
  // Boundary-safe match: `/pkgs/ui` must not claim `/pkgs/ui-icons/*`.
  const isExternalPkg = ctx.externalPackageDirs.some(
    (dir) => file.startsWith(dir + sep) || file === dir
  );
  if (
    !isExternalPkg &&
    excludePatterns.some(
      (pattern) =>
        file.includes(pattern) || relative(ctx.rootDir, file).includes(pattern)
    )
  ) {
    return;
  }

  const absFile = resolve(file);
  const relPath = relative(ctx.rootDir, absFile);

  // Geological reset: system file changed
  const isSystemChange =
    ctx.resolvedSystemPath && absFile === resolve(ctx.resolvedSystemPath);

  if (isSystemChange) {
    const resetStart = performance.now();
    ctx.log(`HMR geological reset: ${relPath}`);
    ctx.loadSystem();

    // Clear Rust-side per-file cache before full re-analysis
    clearEngineCache(ctx.engineApi);

    // Full re-extraction with all cached files.
    // Must send full sources — Rust cache was just cleared, so all files
    // are cache misses and need real source text for OXC parsing.
    const fileEntries: Array<{
      path: string;
      source: string;
      hash: string;
    }> = [];
    for (const [path, { hash, source }] of ctx.fileCache) {
      fileEntries.push({ path, source, hash });
    }
    ctx.runAnalysis(fileEntries);

    ctx.log(
      `HMR geological reset complete: ${Math.round(performance.now() - resetStart)}ms`
    );

    // Geological reset: invalidate BOTH static CSS (vars/globals changed) AND
    // component CSS (bridge needs fresh component CSS too)
    const geologicalModules = [...modules];
    const cssModule = hmrServer.moduleGraph.getModuleById(RESOLVED_CSS_ID);
    if (cssModule) {
      hmrServer.moduleGraph.invalidateModule(cssModule);
      geologicalModules.push(cssModule);
    }
    const compModule = hmrServer.moduleGraph.getModuleById(
      RESOLVED_COMPONENTS_ID
    );
    if (compModule) {
      hmrServer.moduleGraph.invalidateModule(compModule);
      geologicalModules.push(compModule);
    }
    const sysPropModule = hmrServer.moduleGraph.getModuleById(
      RESOLVED_SYSTEM_PROPS_ID
    );
    if (sysPropModule) {
      hmrServer.moduleGraph.invalidateModule(sysPropModule);
      geologicalModules.push(sysPropModule);
    }
    return geologicalModules;
  }

  // Content-hash check: skip if unchanged
  let source: string;
  try {
    source = readFileSync(absFile, 'utf-8');
  } catch {
    return;
  }

  // Preprocess MDX sources on HMR the same way buildStart does.
  // Note: `relPath` is rewritten to end with `.tsx` so the Rust source-type
  // helper parses the preprocessed output as tsx — matching buildStart.
  let scannerRelPath = relPath;
  if (ext === '.mdx') {
    const result = await preprocessMdx(source, relPath);
    if (result.kind === 'missing-dep') {
      ctx.warn(
        '⚠ .mdx HMR skipped: @mdx-js/mdx not installed; restart dev server after installing'
      );
      return;
    }
    if (result.kind === 'error') {
      ctx.warn(`⚠ MDX preprocessing failed for ${relPath}: ${result.error}`);
      return;
    }
    source = result.source!;
    scannerRelPath = relPath + '.tsx';
  }

  const hash = contentHash(source);
  const cached = ctx.fileCache.get(scannerRelPath);
  if (cached && cached.hash === hash) {
    ctx.log(`HMR skip: ${scannerRelPath} (unchanged)`);
    return [];
  }

  // Update cache entry
  ctx.fileCache.set(scannerRelPath, { hash, source });

  const hmrStart = performance.now();

  // Snapshot previous replacements for invalidation diffing
  const prevReplacements = new Map<string, string>();
  if (ctx.storedManifest?.components) {
    for (const [id, desc] of Object.entries(ctx.storedManifest.components)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prevReplacements.set(id, (desc as any).replacement ?? '');
    }
  }

  // Identify directly affected component_ids from the changed file
  const directComponentIds: string[] =
    ctx.storedManifest?.files?.[scannerRelPath] ?? [];
  // Compute transitive invalidation set via reverse_provenance BFS
  const invalidatedIds = new Set(directComponentIds);
  const queue = [...directComponentIds];
  while (queue.length > 0) {
    const parentId = queue.shift()!;
    const children = ctx.reverseProvenance[parentId];
    if (children) {
      for (const childId of children) {
        if (!invalidatedIds.has(childId)) {
          invalidatedIds.add(childId);
          queue.push(childId);
        }
      }
    }
  }

  if (ctx.verbose && invalidatedIds.size > directComponentIds.length) {
    ctx.log(
      `HMR: ${directComponentIds.length} direct + ${invalidatedIds.size - directComponentIds.length} transitive components invalidated`
    );
  }

  // Rebuild file entries from cache and re-run analysis.
  // Pass changedPath so unchanged files send empty source (skip JSON serialization).
  const analysisStart = performance.now();
  const fileEntries = buildFileEntriesFromCache(ctx.fileCache, relPath);
  ctx.runAnalysis(fileEntries);
  const analysisMs = Math.round(performance.now() - analysisStart);

  const modulesToUpdate = [...modules];

  // Invalidate component CSS module (adopted stylesheet in dev, CSS in prod)
  // Static CSS (virtual:animus/styles.css) is NOT invalidated here —
  // it only changes on geological reset (vars/globals are stable during dev)
  const compModule = hmrServer.moduleGraph.getModuleById(
    RESOLVED_COMPONENTS_ID
  );
  if (compModule) {
    hmrServer.moduleGraph.invalidateModule(compModule);
    modulesToUpdate.push(compModule);
  }

  // Invalidate shared system prop map when utility classes change
  const sysPropModule = hmrServer.moduleGraph.getModuleById(
    RESOLVED_SYSTEM_PROPS_ID
  );
  if (sysPropModule) {
    hmrServer.moduleGraph.invalidateModule(sysPropModule);
    modulesToUpdate.push(sysPropModule);
  }

  // Invalidate definition files where component replacement changed.
  // Simple string comparison — if the replacement string differs at all
  // (including systemProps), the definition file needs re-transforming.
  if (ctx.storedManifest?.components) {
    const staleFiles = new Set<string>();
    for (const [id, desc] of Object.entries(ctx.storedManifest.components)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const newReplacement = (desc as any).replacement ?? '';
      const oldReplacement = prevReplacements.get(id) ?? '';
      if (newReplacement !== oldReplacement) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        staleFiles.add((desc as any).file);
      }
    }

    for (const defFile of staleFiles) {
      const absDefPath = resolve(ctx.rootDir, defFile);
      if (absDefPath === absFile) continue;
      const defModule =
        hmrServer.moduleGraph.getModuleById(absDefPath) ??
        hmrServer.moduleGraph.getModulesByFile(absDefPath)?.values().next()
          .value;
      if (defModule) {
        ctx.log(`HMR invalidate: ${defFile} (replacement changed)`);
        hmrServer.moduleGraph.invalidateModule(defModule);
        modulesToUpdate.push(defModule);
      }
    }
  }

  const hmrMs = Math.round(performance.now() - hmrStart);
  const invalidated = modulesToUpdate.length - modules.length;
  ctx.log(
    `HMR update: ${relPath} — analysis ${analysisMs}ms, ${invalidated} modules invalidated, total ${hmrMs}ms`
  );
  ctx.logTimingWaterfall(ctx.storedManifest?.timing ?? {});

  if (modulesToUpdate.length > modules.length) {
    return modulesToUpdate;
  }
}
