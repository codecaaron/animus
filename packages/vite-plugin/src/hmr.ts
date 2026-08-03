import { contentHash, preprocessMdx } from '@animus-ui/extract/pipeline';
import { readFileSync } from 'fs';
import { extname, relative, resolve, sep } from 'path';

import {
  DEFAULT_EXCLUDE,
  RESOLVED_COMPONENTS_ID,
  RESOLVED_SYSTEM_PROPS_ID,
} from './constants';
import { buildFileEntriesFromCache, pruneFileCache } from './context';

import type { PluginContext } from './context';
import type { HotUpdateResult } from './hot-update-events';
import type {
  DevEnvironment,
  EnvironmentModuleNode,
  HotUpdateOptions,
} from 'vite';

/**
 * hotUpdate: the single dev file-event hook. Handles system-dependency
 * membership (geological reset), content-hash diffing with incremental
 * re-analysis, deleted-file cache pruning, and targeted module invalidation
 * (component CSS, system props, and definition files whose replacement
 * changed).
 *
 * Vite 8 dispatches this hook once per environment for ONE file event — the
 * client environment first, then every non-client environment (see
 * `handleHMRUpdate` in vite/dist/node/chunks/node.js). The analysis half is
 * therefore claimed by exactly one dispatch (`ctx.hotUpdateEvents`), while the
 * invalidation half runs in every environment against its own module graph —
 * what the mixed-graph `handleHotUpdate` used to achieve implicitly by
 * invalidating the client and SSR instance behind one module node.
 *
 * The hook fires for every watched file whether or not it has modules in any
 * graph, so system dependencies registered through `watcher.add` outside the
 * root still reach the reset branch, with an empty `modules` list.
 */
export async function handleHotUpdate(
  ctx: PluginContext,
  environment: DevEnvironment,
  { type, file, timestamp, modules }: HotUpdateOptions
): Promise<EnvironmentModuleNode[] | void> {
  // Only active in dev mode
  if (ctx.isProd) return;

  const ownsEvent = ctx.hotUpdateEvents.claim(
    environment.name,
    file,
    timestamp
  );
  const absFile = resolve(file);

  // System-dependency membership comes FIRST — before the event-type split (a
  // dependency file that is created or deleted invalidates the compiler
  // registry exactly like an edited one), before the extension gate (loader
  // deps include .mjs dist entries), and before exclude patterns (an edit to a
  // system module invalidates the compiler registry no matter what the user
  // excluded from component scanning). Terminal: a system dep event is never
  // also component-scanned.
  if (ctx.isSystemDependency(absFile)) {
    if (ownsEvent) ctx.requestGeologicalReset(relative(ctx.rootDir, absFile));
    // The reset ends in its own invalidation plus a full reload; suppress the
    // per-environment update that would otherwise race it.
    return [];
  }

  // A created file needs nothing here: the first transform of the new module
  // folds it into the cache, re-analyzes, and invalidates (transform-time
  // new-file detection, openspec: hmr-new-file-detection). Its own modules are
  // Vite's to update normally.
  if (type === 'create') return;

  if (type === 'delete') {
    if (ownsEvent) pruneDeletedFile(ctx, absFile);
    // The file is gone, so there are no modules of its own to narrow down —
    // `invalidateExtractedModules` delivers the regenerated CSS by reload.
    return;
  }

  if (ownsEvent) {
    ctx.hotUpdateEvents.record(
      file,
      timestamp,
      await analyzeChangedFile(ctx, file, absFile)
    );
  }

  const result = ctx.hotUpdateEvents.resultOf(file, timestamp);
  // Out of extraction scope — leave the update to normal HMR.
  if (result.kind === 'ignored') return;
  // Identical content — suppress the update in every environment.
  if (result.kind === 'unchanged') return [];

  return invalidateStaleModules(
    ctx,
    environment,
    modules,
    result.staleDefinitionFiles
  );
}

/**
 * The once-per-event analysis half: gate the file, diff its content hash,
 * refresh the cache, and re-run project analysis. The returned result is what
 * the remaining environments act on.
 */
async function analyzeChangedFile(
  ctx: PluginContext,
  file: string,
  absFile: string
): Promise<HotUpdateResult> {
  const ext = extname(file);
  if (!ctx.extensionsSet.has(ext)) return { kind: 'ignored' };

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
    return { kind: 'ignored' };
  }

  const relPath = relative(ctx.rootDir, absFile);

  // Content-hash check: skip if unchanged
  let source: string;
  try {
    source = readFileSync(absFile, 'utf-8');
  } catch {
    return { kind: 'ignored' };
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
      return { kind: 'ignored' };
    }
    if (result.kind === 'error') {
      ctx.warn(`⚠ MDX preprocessing failed for ${relPath}: ${result.error}`);
      return { kind: 'ignored' };
    }
    source = result.source!;
    scannerRelPath = relPath + '.tsx';
  }

  const hash = contentHash(source);
  const cached = ctx.fileCache.get(scannerRelPath);
  if (cached && cached.hash === hash) {
    ctx.log(`HMR skip: ${scannerRelPath} (unchanged)`);
    return { kind: 'unchanged' };
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

  // Definition files whose component replacement changed. Simple string
  // comparison — if the replacement string differs at all (including
  // systemProps), the definition file needs re-transforming. The changed file
  // itself is already in every environment's module list.
  const staleDefinitionFiles: string[] = [];
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
      if (resolve(ctx.rootDir, defFile) === absFile) continue;
      staleDefinitionFiles.push(defFile);
    }
  }

  const hmrMs = Math.round(performance.now() - hmrStart);
  ctx.log(
    `HMR update: ${relPath} — analysis ${analysisMs}ms, total ${hmrMs}ms`
  );
  ctx.logTimingWaterfall(ctx.storedManifest?.timing ?? {});

  return { kind: 'analyzed', staleDefinitionFiles };
}

/**
 * Reconcile a deleted file in dev.
 *
 * Without this the removed file's last-known source stays in `ctx.fileCache`,
 * and `buildFileEntriesFromCache` re-feeds that ghost entry to the engine on
 * every later re-analysis — the deleted component's CSS survives for the life
 * of the process.
 */
function pruneDeletedFile(ctx: PluginContext, absFile: string): void {
  if (!pruneFileCache(ctx.fileCache, ctx.rootDir, absFile)) return;

  ctx.runAnalysis(buildFileEntriesFromCache(ctx.fileCache));
  ctx.log(`Deleted file pruned: ${relative(ctx.rootDir, absFile)}`);

  ctx.invalidateExtractedModules();
}

/**
 * The per-environment invalidation half: invalidate the modules this
 * environment serves and widen its update set with them. Static CSS
 * (virtual:animus/styles.css) is NOT invalidated here — it only changes on a
 * geological reset (vars/globals are stable during dev).
 */
function invalidateStaleModules(
  ctx: PluginContext,
  environment: DevEnvironment,
  modules: EnvironmentModuleNode[],
  staleDefinitionFiles: string[]
): EnvironmentModuleNode[] | void {
  const graph = environment.moduleGraph;
  const modulesToUpdate = [...modules];

  // Component CSS (adopted stylesheet in dev, CSS in prod), then the shared
  // system prop map — it changes when utility classes do.
  for (const moduleId of [RESOLVED_COMPONENTS_ID, RESOLVED_SYSTEM_PROPS_ID]) {
    const mod = graph.getModuleById(moduleId);
    if (mod) {
      graph.invalidateModule(mod);
      modulesToUpdate.push(mod);
    }
  }

  for (const defFile of staleDefinitionFiles) {
    const absDefPath = resolve(ctx.rootDir, defFile);
    const defModule =
      graph.getModuleById(absDefPath) ??
      graph.getModulesByFile(absDefPath)?.values().next().value;
    if (defModule) {
      ctx.log(`HMR invalidate: ${defFile} (replacement changed)`);
      graph.invalidateModule(defModule);
      modulesToUpdate.push(defModule);
    }
  }

  const invalidated = modulesToUpdate.length - modules.length;
  if (invalidated > 0) {
    ctx.log(`HMR (${environment.name}): ${invalidated} modules invalidated`);
    return modulesToUpdate;
  }
}
