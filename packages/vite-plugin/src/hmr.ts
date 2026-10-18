import {
  contentHash,
  isPathWithinRoot,
  outputSourceGuard,
  outputSourceMessage,
} from '@animus-ui/extract/pipeline';
import { CoalescingWindow } from '@animus-ui/extract/session';
import { extname, relative, resolve } from 'path';

import { RESOLVED_COMPONENTS_ID, RESOLVED_SYSTEM_PROPS_ID } from './constants';
import { invalidateFileModules } from './module-invalidation';
import { reconcileSourceCorpus } from './rediscovery';
import { applyPublished, changesOf, mergePublished } from './session-outcomes';
import { applyDevBridgeImport, extendingFiles } from './transform';
import { systemPropsAdoptable } from './virtual-modules';

import type { ObservedOutcome, PluginContext } from './context';
import type { HotUpdateResult } from './hot-update-events';
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
    if (ownsEvent) requestSystemReload(ctx, absFile, type);
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

/** Each context's pending system-dependency events, and the window they
 *  wait out together. */
const systemReloads = new WeakMap<
  PluginContext,
  {
    window: CoalescingWindow;
    pending: Map<string, HotUpdateOptions['type']>;
  }
>();

/** A system dependency's event waits out the coalescing window (SA19)
 *  before the Session reads it: a watcher can report a write as it starts
 *  and drop the event for its end, so an immediate read would load a
 *  half-written module. Events in one window reload once. */
function requestSystemReload(
  ctx: PluginContext,
  absFile: string,
  type: HotUpdateOptions['type']
): void {
  let state = systemReloads.get(ctx);
  if (state === undefined) {
    const pending = new Map<string, HotUpdateOptions['type']>();
    state = {
      pending,
      window: new CoalescingWindow(() => {
        if (pending.size === 0) return;
        const taken = [...pending];
        pending.clear();
        return reloadSystem(ctx, taken);
      }),
    };
    systemReloads.set(ctx, state);
  }
  ctx.log(`HMR system reload scheduled: ${relative(ctx.rootDir, absFile)}`);
  state.pending.set(absFile, type);
  state.window.note();
}

/** Runs a pending system reload now, closing its window (the window's
 *  bypass), and settles with it. */
export async function flushSystemReload(ctx: PluginContext): Promise<void> {
  await systemReloads.get(ctx)?.window.flush();
}

/** Drops a pending system reload: the context is closing. */
export function cancelSystemReload(ctx: PluginContext): void {
  const state = systemReloads.get(ctx);
  state?.window.cancel();
  state?.pending.clear();
}

/** Reloads the system through the Session over the window's events. It
 *  runs from a timer, so it never throws: a failed reload keeps the last
 *  good system served and warns; under `strict` the client overlay reports
 *  it too. */
async function reloadSystem(
  ctx: PluginContext,
  events: ReadonlyArray<[string, HotUpdateOptions['type']]>
): Promise<void> {
  const reloadStart = performance.now();
  const modifiedFiles = new Set<string>();
  const removedFiles = new Set<string>();
  for (const [path, type] of events) {
    (type === 'delete' ? removedFiles : modifiedFiles).add(path);
  }
  let outcomes: ObservedOutcome[];
  try {
    outcomes = await ctx.submitChanges({ modifiedFiles, removedFiles });
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
    // The failed reload re-serves the last good system.
    ctx.invalidateSystemReloadModules(true);
    return;
  }
  const merged = mergePublished(outcomes);
  applyPublished(ctx, merged);
  // The reload goes out as Animus's own payload, which Vite does not log as
  // it logs the page reloads it decides.
  if (merged.full && ctx.devServer) {
    const changed = events.map(([path]) => relative(ctx.rootDir, path));
    ctx.info(`page reload ${changed.join(', ')} (system reload)`);
  }
  // A held reload re-serves the published system's unchanged bytes.
  if (!merged.published) ctx.invalidateSystemReloadModules(false);
  else {
    ctx.log(
      `HMR system reload complete: ${Math.round(performance.now() - reloadStart)}ms`
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
  const outputDir = outputSourceGuard(ctx.rootDir, ctx.outputExcludes)(absFile);
  if (outputDir !== null) {
    ctx.warn(outputSourceMessage(relPath, outputDir));
    return { kind: 'ignored' };
  }

  // Vite's `read` retries on the empty content an atomic save exposes, and
  // returns the settled bytes while the disk may still be empty: the
  // Session analyzes those bytes, not a second read of the disk.
  let settled: string | undefined;
  try {
    settled = read ? await read() : undefined;
  } catch {
    return { kind: 'ignored' };
  }

  const hmrStart = performance.now();
  const changes = changesOf('update', absFile);
  const outcomes = await ctx.submitChanges(
    settled === undefined
      ? changes
      : { ...changes, sources: new Map([[absFile, settled]]) }
  );
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
  // Reconcile on-disk sources before acting on the result: a parent whose
  // create event was lost folds in here, so the consumer re-serves extracted.
  const merged = mergePublished([
    ...outcomes,
    ...(await reconcileSourceCorpus(ctx)),
  ]);
  applyPublished(ctx, merged);

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
    await ctx.submitChanges(changesOf('delete', absFile))
  );
  if (!merged.published) return;
  applyPublished(ctx, merged);
  ctx.trace(`Deleted file pruned: ${relative(ctx.rootDir, absFile)}`);

  // No exclusion: evicting the deleted file's own residual nodes is harmless
  // and closes the delete-then-recreate-same-path window. A full pass has
  // already evicted them (applyPublished).
  if (!merged.full) invalidateFileModules(ctx, [...merged.planChanged]);

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

  // The components module this environment holds is current while the CSS
  // it was built from is; nothing it was built from changes in between.
  const moduleIds: string[] = [];
  const served = ctx.servedComponentCss.get(environment.name);
  if (served === undefined || served !== ctx.resolvedComponentCss) {
    moduleIds.push(RESOLVED_COMPONENTS_ID);
  }
  if (analyzed.systemPropsChanged) moduleIds.push(RESOLVED_SYSTEM_PROPS_ID);
  for (const moduleId of moduleIds) {
    const mod = graph.getModuleById(moduleId);
    if (mod) {
      graph.invalidateModule(mod);
      // A map generation that may not be taken in place reaches its
      // importers now. Vite reads the boundary from the generation served
      // before, so one that had it would take a hot step first, and its
      // callback's invalidate would then be ignored, since the generation
      // now served accepts nothing.
      if (moduleId === RESOLVED_SYSTEM_PROPS_ID && !systemPropsAdoptable(ctx)) {
        mod.isSelfAccepting = false;
      }
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
    const delivered = modulesToUpdate.some(
      (mod) => mod.id === RESOLVED_COMPONENTS_ID
    )
      ? 'CSS delivered'
      : 'CSS unchanged';
    ctx.log(
      `HMR (${environment.name}): presentation-only — ${modules.length} module update(s) suppressed, ${delivered}`
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
