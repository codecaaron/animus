import {
  contentHash,
  isPathWithinRoot,
  outputSourceGuard,
  outputSourceMessage,
} from '@animus-ui/extract/pipeline';
import { extname, relative, resolve } from 'path';

import { RESOLVED_COMPONENTS_ID, RESOLVED_SYSTEM_PROPS_ID } from './constants';
import { invalidateFileModules } from './module-invalidation';
import { reconcileSourceCorpus } from './rediscovery';
import { applyDevBridgeImport, extendingFiles } from './transform';

import type { ObservedOutcome, PluginContext } from './context';
import type { HotUpdateResult } from './hot-update-events';
import type { WatchChanges } from '@animus-ui/extract/session';
import type {
  DevEnvironment,
  EnvironmentModuleNode,
  HotUpdateOptions,
} from 'vite';

/** Vite dispatches this hook once per environment for one file event: the
 *  dispatch that claims it submits the file to the Session, and invalidation
 *  runs in each. */
export async function handleHotUpdate(
  ctx: PluginContext,
  environment: DevEnvironment,
  { type, file, timestamp, modules, read }: HotUpdateOptions
): Promise<EnvironmentModuleNode[] | void> {
  if (ctx.isProd) return;
  const ownsEvent = ctx.hotUpdateEvents.claim(
    environment.name,
    file,
    timestamp
  );
  const absFile = resolve(file);
  ctx.trace(
    `hotUpdate ${type} ${relative(ctx.rootDir, absFile)} env=${environment.name} owns=${ownsEvent}`
  );

  if (ctx.isSystemDependency(absFile)) {
    if (ownsEvent) await reloadSystem(ctx, absFile, type);
    return [];
  }

  if (ctx.assetCopyDir !== null && ctx.isAssetSource(absFile)) {
    if (ownsEvent && type !== 'delete') ctx.refreshAssetCopies(absFile);
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

/** The file event as a Session change set. */
function changesOf(
  type: HotUpdateOptions['type'],
  absFile: string
): WatchChanges {
  const files = new Set([absFile]);
  return type === 'delete' ? { removedFiles: files } : { modifiedFiles: files };
}

/** What the published outcomes of one submission change, merged. */
function mergePublished(outcomes: readonly ObservedOutcome[]) {
  const merged = {
    published: false,
    full: false,
    endedHold: false,
    systemPropsChanged: false,
    planChanged: new Set<string>(),
    redeliver: new Set<string>(),
  };
  for (const { outcome, systemPropsChanged } of outcomes) {
    if (outcome.kind !== 'published') continue;
    merged.published = true;
    merged.full ||= outcome.pass === 'full';
    merged.endedHold ||= outcome.endedHold;
    merged.systemPropsChanged ||= systemPropsChanged;
    for (const path of outcome.planChanged) merged.planChanged.add(path);
    for (const path of outcome.redeliver) merged.redeliver.add(path);
  }
  return merged;
}

/** Acts on what every submission's publications owe the module graph: a
 *  publication that ends a hold re-delivers the originals whose bytes
 *  changed meanwhile, and a full pass (a system reload) reloads the
 *  client. */
function applyPublished(
  ctx: PluginContext,
  merged: ReturnType<typeof mergePublished>
): void {
  if (merged.redeliver.size > 0) {
    invalidateFileModules(ctx, [...merged.redeliver]);
  }
  if (merged.full) {
    // A type-only definition module has no import edge, so importer
    // propagation cannot deliver its new bytes — evict changed plans.
    invalidateFileModules(ctx, [...merged.planChanged]);
    ctx.invalidateSystemReloadModules(true);
  }
}

/** A system dependency's event reloads the system through the Session. A
 *  failed reload keeps the last good system served and warns; under
 *  `strict` the client overlay reports it too. */
async function reloadSystem(
  ctx: PluginContext,
  absFile: string,
  type: HotUpdateOptions['type']
): Promise<void> {
  const resetStart = performance.now();
  ctx.log(`HMR system reload: ${relative(ctx.rootDir, absFile)}`);
  let outcomes: ObservedOutcome[];
  try {
    outcomes = await ctx.submitChanges(changesOf(type, absFile));
  } catch (err) {
    ctx.warn(`[animus-extract] system reload failed: ${String(err)}`);
    if (ctx.options.strict) {
      const message = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? (err.stack ?? '') : '';
      ctx.devServer?.hot?.send({
        type: 'error',
        err: { message, stack, plugin: 'animus-extract' },
      });
    }
    // The reset re-serves the last good system.
    ctx.invalidateSystemReloadModules(true);
    return;
  }
  const merged = mergePublished(outcomes);
  applyPublished(ctx, merged);
  // A held reload re-serves the published system's unchanged bytes.
  if (!merged.published) ctx.invalidateSystemReloadModules(false);
  else {
    ctx.log(
      `HMR system reload complete: ${Math.round(performance.now() - resetStart)}ms`
    );
  }
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
  const outputDir = outputSourceGuard(
    ctx.rootDir,
    ctx.outputExclude === null ? [] : [ctx.outputExclude]
  )(absFile);
  if (outputDir !== null) {
    ctx.warn(outputSourceMessage(relPath, outputDir));
    return { kind: 'ignored' };
  }

  // Vite's `read` retries on the empty content an atomic save exposes, so
  // the Session reads the settled bytes.
  try {
    if (read) await read();
  } catch {
    return { kind: 'ignored' };
  }

  const hmrStart = performance.now();
  const outcomes = await ctx.submitChanges({
    modifiedFiles: new Set([absFile]),
  });
  const last = outcomes.at(-1)?.outcome;
  // Nothing published: the Session read no change.
  if (last === undefined) {
    ctx.trace(`HMR skip: ${relPath} (unchanged)`);
    return { kind: 'unchanged' };
  }
  // An aborted parse holds publication and keeps this edit for the repair
  // to publish. Only broken bytes reach Vite, which reports them; a held
  // valid edit delivers nothing until the repair re-delivers it.
  if (last.kind === 'held') {
    return last.abortedOriginals.has(relPath)
      ? { kind: 'ignored' }
      : { kind: 'unchanged' };
  }
  const merged = mergePublished(outcomes);
  applyPublished(ctx, merged);
  // Reconcile on-disk sources before acting on the result: a parent whose
  // create event was lost folds in here, so the consumer re-serves extracted.
  await reconcileSourceCorpus(ctx);

  // Ending a hold re-delivers the edited module too: the client may hold a
  // failed request for it, or none after a reload during the failure.
  const published = ctx.session!.corpus.published;
  const nativeEntry = published.analysisEntries.get(relPath);
  const presentationOnly =
    nativeEntry && !merged.endedHold
      ? isPresentationOnlyEdit(ctx, relPath, nativeEntry.source)
      : false;

  // An extension reads the callbacks it inherits from its parent's module as
  // it runs, so every module re-delivered here re-delivers its extensions.
  const redelivered = presentationOnly ? [] : [relPath, ...merged.redeliver];
  // Filtered by resolved path, not cache key — MDX plans carry the
  // `.tsx`-suffixed key, and the changed file is already in the module list.
  const staleDefinitionFiles = [
    ...new Set([
      ...merged.planChanged,
      ...merged.redeliver,
      ...extendingFiles(
        ctx,
        redelivered.flatMap(
          (path) => published.ownership[path]?.analysisPaths ?? [path]
        )
      ),
    ]),
  ].filter((defFile) => resolve(ctx.rootDir, defFile) !== absFile);

  ctx.log(
    `HMR update: ${relPath} — total ${Math.round(performance.now() - hmrStart)}ms${presentationOnly ? ' (presentation-only)' : ''}`
  );

  return {
    kind: 'analyzed',
    staleDefinitionFiles,
    systemPropsChanged: merged.systemPropsChanged,
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

/** A deleted file leaves the Session's corpus, so its CSS stops being
 *  re-emitted. */
async function pruneDeletedFile(
  ctx: PluginContext,
  absFile: string
): Promise<void> {
  const merged = mergePublished(
    await ctx.submitChanges({ removedFiles: new Set([absFile]) })
  );
  if (!merged.published) return;
  applyPublished(ctx, merged);
  ctx.trace(`Deleted file pruned: ${relative(ctx.rootDir, absFile)}`);

  // No exclusion: evicting the deleted file's own residual nodes is harmless
  // and closes the delete-then-recreate-same-path window.
  invalidateFileModules(ctx, [...merged.planChanged]);

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
      ctx.trace(`HMR invalidate: ${defFile} (re-delivered)`);
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
