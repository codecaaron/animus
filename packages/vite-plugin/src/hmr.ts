import {
  contentHash,
  diffFilePlans,
  isPathWithinRoot,
  snapshotFilePlans,
} from '@animus-ui/extract/pipeline';
import { readFileSync } from 'fs';
import { extname, relative, resolve } from 'path';

import { RESOLVED_COMPONENTS_ID, RESOLVED_SYSTEM_PROPS_ID } from './constants';
import {
  pruneFileCache,
  runExclusiveAnalysis,
  systemPropsModuleSource,
} from './context';
import { invalidateFileModules } from './module-invalidation';
import { reconcileSourceCorpus } from './rediscovery';
import { applyDevBridgeImport } from './transform';

import type { PluginContext } from './context';
import type { HotUpdateResult } from './hot-update-events';
import type {
  DevEnvironment,
  EnvironmentModuleNode,
  HotUpdateOptions,
} from 'vite';

/** Vite dispatches this hook once per environment for one file event: the
 *  analysis half is claimed by one dispatch, invalidation runs in each. */
export async function handleHotUpdate(
  ctx: PluginContext,
  environment: DevEnvironment,
  options: HotUpdateOptions
): Promise<EnvironmentModuleNode[] | void> {
  if (ctx.isProd) return;
  return runExclusiveAnalysis(ctx, () =>
    handleHotUpdateExclusive(ctx, environment, options)
  );
}

async function handleHotUpdateExclusive(
  ctx: PluginContext,
  environment: DevEnvironment,
  { type, file, timestamp, modules, read }: HotUpdateOptions
): Promise<EnvironmentModuleNode[] | void> {
  const ownsEvent = ctx.hotUpdateEvents.claim(
    environment.name,
    file,
    timestamp
  );
  const absFile = resolve(file);
  ctx.log(
    `hotUpdate ${type} ${relative(ctx.rootDir, absFile)} env=${environment.name} owns=${ownsEvent}`
  );

  if (ctx.isSystemDependency(absFile)) {
    if (ownsEvent) {
      await reconcileSourceEntry(ctx, absFile, type, read);
      ctx.requestSystemReload(relative(ctx.rootDir, absFile));
    }
    return [];
  }

  if (type === 'delete') {
    if (ownsEvent) await pruneDeletedFile(ctx, absFile);
    return;
  }

  if (ownsEvent) {
    ctx.hotUpdateEvents.record(
      file,
      timestamp,
      await analyzeChangedFile(ctx, file, absFile, read)
    );
  }

  const result = ctx.hotUpdateEvents.resultOf(file, timestamp);
  if (result.kind === 'ignored') return;
  if (result.kind === 'evicted') {
    ctx.log(
      `HMR (${environment.name}): decision for ${relative(ctx.rootDir, absFile)} evicted — invalidating conservatively`
    );
    return invalidateStaleModules(ctx, environment, modules, {
      staleDefinitionFiles: [],
      systemPropsChanged: true,
      presentationOnly: false,
    });
  }
  if (result.kind === 'unchanged') {
    if (type === 'create') return;
    return [];
  }

  return invalidateStaleModules(ctx, environment, modules, result);
}

/** Prefers Vite's `read`, which retries on the empty content an atomic save
 *  exposes; the direct read serves hosts that supply no `read`. */
async function readChangedSource(
  absFile: string,
  read: HotUpdateOptions['read'] | undefined
): Promise<string> {
  return read ? await read() : readFileSync(absFile, 'utf-8');
}

/** Keeps the cache entry of a file that is both a system dependency and a
 *  discovered source; a file with no entry must never gain one here. */
async function reconcileSourceEntry(
  ctx: PluginContext,
  absFile: string,
  type: HotUpdateOptions['type'],
  read: HotUpdateOptions['read'] | undefined
): Promise<void> {
  if (type === 'delete') {
    ctx.mutateFileCache((cache) => pruneFileCache(cache, ctx.rootDir, absFile));
    return;
  }

  const relPath = relative(ctx.rootDir, absFile);
  if (!ctx.fileCache.has(relPath)) return;

  let source: string;
  try {
    source = await readChangedSource(absFile, read);
  } catch {
    ctx.warn(
      `could not re-read ${relPath} after a system-dependency edit — ` +
        `system reloads will analyze its pre-edit text until a later ` +
        `edit is read successfully`
    );
    return;
  }
  ctx.mutateFileCache((cache) =>
    cache.set(relPath, { hash: contentHash(source), source })
  );
}

/** The once-per-event analysis half; its result is what the remaining
 *  environments act on. */
async function analyzeChangedFile(
  ctx: PluginContext,
  file: string,
  absFile: string,
  read: HotUpdateOptions['read'] | undefined
): Promise<HotUpdateResult> {
  const ext = extname(file);
  if (!ctx.extensionsSet.has(ext)) return { kind: 'ignored' };

  const excludeMatcher = ctx.excludeMatcher;
  const isExternalPkg = ctx.externalPackageDirs.some((dir) =>
    isPathWithinRoot(dir, file)
  );
  if (
    !isExternalPkg &&
    excludeMatcher.matches(file, relative(ctx.rootDir, file))
  ) {
    return { kind: 'ignored' };
  }

  const relPath = relative(ctx.rootDir, absFile);

  let source: string;
  try {
    source = await readChangedSource(absFile, read);
  } catch {
    return { kind: 'ignored' };
  }

  const hash = contentHash(source);
  const cached = ctx.fileCache.get(relPath);
  if (cached && cached.hash === hash) {
    ctx.log(`HMR skip: ${relPath} (unchanged)`);
    return { kind: 'unchanged' };
  }

  const priorExternalOwner = ctx.externalFileOwners[relPath];
  if (isExternalPkg && !priorExternalOwner) {
    const owner = Object.entries(ctx.externalDirOwners).find(([dir]) =>
      isPathWithinRoot(dir, absFile)
    );
    if (owner) ctx.externalFileOwners[relPath] = owner[1];
  }

  ctx.mutateFileCache((cache) => cache.set(relPath, { hash, source }));
  const restoreEntry = () => {
    ctx.mutateFileCache((cache) => {
      if (cached) cache.set(relPath, cached);
      else cache.delete(relPath);
    });
    if (priorExternalOwner) {
      ctx.externalFileOwners[relPath] = priorExternalOwner;
    } else {
      delete ctx.externalFileOwners[relPath];
    }
  };

  const hmrStart = performance.now();

  const prevPlans = snapshotFilePlans(ctx.storedManifest);

  const previousAnalysisPaths = ctx.corpus.published.ownership[relPath]
    ?.analysisPaths ?? [relPath];
  const directComponentIds: string[] = previousAnalysisPaths.flatMap(
    (analysisPath) => ctx.storedManifest?.files[analysisPath] ?? []
  );
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

  const analysisStart = performance.now();
  const systemPropsBefore = systemPropsModuleSource(ctx);
  let analysisOk: boolean;
  try {
    analysisOk = (await ctx.analyzeIngested()).ok;
  } catch (e) {
    restoreEntry();
    throw e;
  }
  if (!analysisOk) {
    restoreEntry();
    return { kind: 'ignored' };
  }
  try {
    await reconcileSourceCorpus(ctx);
  } catch (e) {
    restoreEntry();
    throw e;
  }
  const systemPropsChanged = systemPropsModuleSource(ctx) !== systemPropsBefore;
  const analysisMs = Math.round(performance.now() - analysisStart);

  // Filtered by resolved path, not cache key — MDX plans carry the
  // `.tsx`-suffixed key, and the changed file is already in the module list.
  const staleDefinitionFiles = diffFilePlans(
    prevPlans,
    snapshotFilePlans(ctx.storedManifest)
  ).filter((defFile) => resolve(ctx.rootDir, defFile) !== absFile);

  const nativeEntry = ctx.corpus.published.analysisEntries.get(relPath);
  const presentationOnly = nativeEntry
    ? isPresentationOnlyEdit(ctx, relPath, nativeEntry.source)
    : false;

  const hmrMs = Math.round(performance.now() - hmrStart);
  ctx.log(
    `HMR update: ${relPath} — analysis ${analysisMs}ms, total ${hmrMs}ms${presentationOnly ? ' (presentation-only)' : ''}`
  );
  ctx.logTimingWaterfall(ctx.storedManifest?.timing ?? {});

  return {
    kind: 'analyzed',
    staleDefinitionFiles,
    systemPropsChanged,
    presentationOnly,
  };
}

/** True when the file's transform output is byte-identical across the edit.
 *  Compares the full served bytes and fails open, so mixed edits deliver. */
function isPresentationOnlyEdit(
  ctx: PluginContext,
  scannerRelPath: string,
  source: string
): boolean {
  const servedHash = ctx.transformOutputHashes.get(scannerRelPath);
  if (!servedHash || !ctx.storedManifestJson) return false;
  if (!ctx.storedManifest?.files[scannerRelPath]?.length) return false;
  try {
    const { transformFile } = ctx.engineApi();
    const fresh = transformFile(source, scannerRelPath, ctx.storedManifestJson);
    if (!fresh.hasComponents) return false;
    return contentHash(applyDevBridgeImport(fresh.code)) === servedHash;
  } catch {
    return false;
  }
}

/** Prune a deleted file from the cache: a surviving entry is re-fed to the
 *  engine forever, so the deleted component's CSS never disappears. */
async function pruneDeletedFile(
  ctx: PluginContext,
  absFile: string
): Promise<void> {
  const relPath = relative(ctx.rootDir, absFile);
  const cached = ctx.fileCache.get(relPath);
  if (!cached) return;
  const pruned = ctx.mutateFileCache((cache) =>
    pruneFileCache(cache, ctx.rootDir, absFile)
  );
  if (!pruned) return;

  const prevPlans = snapshotFilePlans(ctx.storedManifest);
  const { ok } = await ctx.analyzeIngested();
  if (!ok) return;
  ctx.log(`Deleted file pruned: ${relative(ctx.rootDir, absFile)}`);

  // No exclusion: evicting the deleted file's own residual nodes is harmless
  // and closes the delete-then-recreate-same-path window.
  invalidateFileModules(
    ctx,
    diffFilePlans(prevPlans, snapshotFilePlans(ctx.storedManifest))
  );

  ctx.invalidateExtractedModules();
}

type InvalidationPlan = Omit<
  Extract<HotUpdateResult, { kind: 'analyzed' }>,
  'kind'
>;

/** The per-environment invalidation half. Static CSS is left alone: it only
 *  changes on a system reload, since vars and globals are stable in dev. */
function invalidateStaleModules(
  ctx: PluginContext,
  environment: DevEnvironment,
  modules: EnvironmentModuleNode[],
  analyzed: InvalidationPlan
): EnvironmentModuleNode[] | void {
  const graph = environment.moduleGraph;
  const modulesToUpdate = analyzed.presentationOnly ? [] : [...modules];

  const moduleIds = [RESOLVED_COMPONENTS_ID];
  if (analyzed.systemPropsChanged) moduleIds.push(RESOLVED_SYSTEM_PROPS_ID);
  for (const moduleId of moduleIds) {
    const mod = graph.getModuleById(moduleId);
    if (mod) {
      graph.invalidateModule(mod);
      modulesToUpdate.push(mod);
    }
  }

  for (const defFile of analyzed.staleDefinitionFiles) {
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

  if (analyzed.presentationOnly) {
    ctx.log(
      `HMR (${environment.name}): presentation-only — ${modules.length} module update(s) suppressed, CSS delivered`
    );
    for (const mod of modules) {
      // A server closing mid-warm must not surface as an unhandled rejection.
      if (mod.url)
        void environment.transformRequest?.(mod.url)?.catch(() => {});
    }
    // Returning the set is the suppression: a void return lets Vite update
    // the changed module by default.
    return modulesToUpdate;
  }

  const invalidated = modulesToUpdate.length - modules.length;
  if (invalidated > 0) {
    ctx.log(`HMR (${environment.name}): ${invalidated} modules invalidated`);
    return modulesToUpdate;
  }
}
