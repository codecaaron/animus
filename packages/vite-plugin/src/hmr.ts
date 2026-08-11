import {
  contentHash,
  diffFilePlans,
  isPathWithinRoot,
  snapshotFilePlans,
  withoutInvalidOriginals,
} from '@animus-ui/extract/pipeline';
import { readFileSync } from 'fs';
import { extname, relative, resolve } from 'path';

import {
  DEFAULT_EXCLUDE,
  RESOLVED_COMPONENTS_ID,
  RESOLVED_SYSTEM_PROPS_ID,
} from './constants';
import {
  buildRawEntriesFromCache,
  pruneFileCache,
  runExclusiveAnalysis,
  systemPropsModuleSource,
} from './context';
import { invalidateFileModules } from './module-invalidation';
import { stabilizeSourceUniverse } from './rediscovery';
import { applyDevBridgeImport } from './transform';

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
  options: HotUpdateOptions
): Promise<EnvironmentModuleNode[] | void> {
  // Only active in dev mode
  if (ctx.isProd) return;
  // Exclusive: hot updates, transform new-file detections, and geological
  // resets all run ingest→analyze→publish transactions over the shared
  // fileCache across await points — serialize at the entry point (internal
  // helpers like stabilize/prune stay unlocked).
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
  // Entry evidence for the dev-lane trace: which events actually reached the
  // plugin, and which dispatch owned them. A watcher event that never prints
  // this line was lost upstream (chokidar throttle or Vite's dispatch chain).
  ctx.log(
    `hotUpdate ${type} ${relative(ctx.rootDir, absFile)} env=${environment.name} owns=${ownsEvent}`
  );

  // System-dependency membership comes FIRST — before the event-type split (a
  // dependency file that is created or deleted invalidates the compiler
  // registry exactly like an edited one), before the extension gate (loader
  // deps include .mjs dist entries), and before exclude patterns (an edit to a
  // system module invalidates the compiler registry no matter what the user
  // excluded from component scanning). Terminal: a system dep event is never
  // also component-scanned.
  if (ctx.isSystemDependency(absFile)) {
    if (ownsEvent) {
      // Terminal branch: neither the edit path's cache write nor the delete
      // path's pruning below is reachable from here, so a file that is BOTH a
      // dependency and a discovered source needs its cache entry reconciled
      // first — otherwise it keeps pre-edit text, or survives deletion, for the
      // life of the process.
      await reconcileSourceEntry(ctx, absFile, type, read);
      ctx.requestGeologicalReset(relative(ctx.rootDir, absFile));
    }
    // The reset ends in its own invalidation plus a full reload; suppress the
    // per-environment update that would otherwise race it.
    return [];
  }

  // A created file feeds the SAME analysis path as an edit (openspec:
  // hmr-new-file-detection, "Watcher creation ingestion") — the graph is
  // then usually complete before any consumer refetches, so an imported
  // parent introduced mid-session extracts on its consumers' first serve.
  // A create that transform-time detection already registered coalesces
  // through the content-hash gate below; detection stays the backstop for
  // creations the watcher never reports.

  if (type === 'delete') {
    if (ownsEvent) await pruneDeletedFile(ctx, absFile);
    // The file is gone, so there are no modules of its own to narrow down —
    // `invalidateExtractedModules` delivers the regenerated CSS by reload.
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
  // Out of extraction scope — leave the update to normal HMR.
  if (result.kind === 'ignored') return;
  if (result.kind === 'unchanged') {
    // A create can be pre-satisfied here: rediscovery folded the file into
    // the cache at its on-disk hash before the lagging watcher event landed.
    // Vite 8 treats a returned [] as an explicit empty module list (truthy
    // gate), which would discard the resolve-failed importers it seeds on
    // create — the very modules whose full-reload clears the "Failed to
    // resolve import" overlay. Express no opinion instead.
    if (type === 'create') return;
    // Identical content — suppress the update in every environment.
    return [];
  }

  return invalidateStaleModules(ctx, environment, modules, result);
}

/**
 * The changed file's text.
 *
 * Editors save atomically — truncate, then rewrite — so a watcher event can
 * arrive while the path is momentarily EMPTY. Vite's `read()` helper retries on
 * empty content for exactly that reason; reading the path directly at the same
 * moment yields `''`, and since the corrective content produces no second
 * event, that empty source would be cached permanently.
 *
 * Vite always supplies `read`, so the direct read is NOT a fallback for Vite:
 * it exists for hosts that drive this hook without one. The dev-lane's adapter
 * contract is deliberately bundler-neutral, and a second runtime satisfying it
 * must not be forced to fabricate a helper to get correct behavior.
 */
async function readChangedSource(
  absFile: string,
  read: HotUpdateOptions['read'] | undefined
): Promise<string> {
  return read ? await read() : readFileSync(absFile, 'utf-8');
}

/**
 * Reconcile the `fileCache` entry of a file that is BOTH a system dependency
 * and a discovered component source, since the dependency branch is terminal —
 * neither the edit path's cache write nor `pruneDeletedFile` runs for it.
 *
 * An edit refreshes the entry: `performGeologicalReset` rebuilds its
 * full-source analysis from this cache, so a stale entry would be re-analyzed
 * on every later reset. A delete prunes it, exactly as the ordinary delete path
 * would (openspec: hmr-new-file-detection, "Watcher deletion pruning") — a
 * surviving entry is a ghost source no watcher event can ever name again.
 *
 * Dependency-only files have no entry: `pruneFileCache` no-ops for them, and
 * the edit path must not create one — the cache is the component-source set,
 * and a phantom entry would feed the engine a file it never discovered.
 */
async function reconcileSourceEntry(
  ctx: PluginContext,
  absFile: string,
  type: HotUpdateOptions['type'],
  read: HotUpdateOptions['read'] | undefined
): Promise<void> {
  if (type === 'delete') {
    pruneFileCache(ctx.fileCache, ctx.rootDir, absFile);
    return;
  }

  const relPath = relative(ctx.rootDir, absFile);
  if (!ctx.fileCache.has(relPath)) return;

  let source: string;
  try {
    source = await readChangedSource(absFile, read);
  } catch {
    // No corrective event follows a failed read, so the stale entry survives
    // every later geological reset — say so instead of failing silently.
    ctx.warn(
      `could not re-read ${relPath} after a system-dependency edit — ` +
        `geological resets will analyze its pre-edit text until a later ` +
        `edit is read successfully`
    );
    return;
  }
  ctx.fileCache.set(relPath, { hash: contentHash(source), source });
}

/**
 * The once-per-event analysis half: gate the file, diff its content hash,
 * refresh the cache, and re-run project analysis. The returned result is what
 * the remaining environments act on.
 */
async function analyzeChangedFile(
  ctx: PluginContext,
  file: string,
  absFile: string,
  read: HotUpdateOptions['read'] | undefined
): Promise<HotUpdateResult> {
  const ext = extname(file);
  if (!ctx.extensionsSet.has(ext)) return { kind: 'ignored' };

  const excludePatterns = ctx.options.exclude ?? DEFAULT_EXCLUDE;
  // Boundary-safe membership via the shared containment predicate.
  const isExternalPkg = ctx.externalPackageDirs.some((dir) =>
    isPathWithinRoot(dir, file)
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

  // A watcher-created external package file needs its ownership recorded
  // before this analysis (parity with transform-time detection in
  // transform.ts): the token-contract correlation joins on
  // `fileOwners[diagnostic.file]`, and a file that enters the cache here
  // skips the transform-time registration block for good.
  const priorExternalOwner = ctx.externalFileOwners[relPath];
  if (isExternalPkg && !priorExternalOwner) {
    const owner = Object.entries(ctx.externalDirOwners).find(([dir]) =>
      isPathWithinRoot(dir, absFile)
    );
    if (owner) ctx.externalFileOwners[relPath] = owner[1];
  }

  // Update cache entry — rolled back below if the analysis fails to publish,
  // so the same-content retry is never hash-suppressed.
  ctx.fileCache.set(relPath, { hash, source });
  const restoreEntry = () => {
    if (cached) ctx.fileCache.set(relPath, cached);
    else ctx.fileCache.delete(relPath);
    if (priorExternalOwner) {
      ctx.externalFileOwners[relPath] = priorExternalOwner;
    } else {
      delete ctx.externalFileOwners[relPath];
    }
  };

  const hmrStart = performance.now();

  // Snapshot previous file plans for invalidation diffing
  const prevPlans = snapshotFilePlans(ctx.storedManifest);

  // Identify directly affected component_ids from the changed file
  const previousAnalysisPaths = ctx.sourceOwnership[relPath]?.analysisPaths ?? [
    relPath,
  ];
  const directComponentIds: string[] = previousAnalysisPaths.flatMap(
    (analysisPath) => ctx.storedManifest?.files?.[analysisPath] ?? []
  );
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

  // Rebuild parser entries from raw ownership and re-run analysis.
  // The system-props change decision compares the GENERATED MODULE across the
  // whole transaction (analysis + stabilization): the map is one of four
  // independently-moving inputs, so comparing the served artifact itself is
  // what catches e.g. a widened `.system({...})` opt-in that mints no new
  // utility class (openspec: vite-extraction-plugin, "System prop map HMR
  // invalidation"). `false` is runAnalysis's only failure signal — a `void`
  // runAnalysis (behavioral test doubles) still reads as success.
  const analysisStart = performance.now();
  const systemPropsBefore = systemPropsModuleSource(ctx);
  let analysisOk: boolean;
  let ingested;
  try {
    ingested = await ctx.ingestRawSources(
      buildRawEntriesFromCache(ctx.fileCache)
    );
    // Per-file quarantine, buildStart parity: an invalid original (its own
    // diagnostic, or a permanently-diagnosable unrelated file — an `.mdx`
    // with the optional peer absent) is excluded and warned about; the rest
    // of the corpus still re-analyzes. Aborting here froze HMR for the
    // whole project on one bad file. Strict mode still throws (overlay).
    ingested = withoutInvalidOriginals(
      ingested,
      ctx.surfaceSourceDiagnostics(ingested.diagnostics)
    );
    analysisOk = ctx.runAnalysis(ingested.analysisEntries) !== false;
  } catch (e) {
    // Strict mode rethrows to Vite's overlay; the entry still rolls back so
    // a same-content retry re-analyzes after the source is corrected.
    restoreEntry();
    throw e;
  }
  if (!analysisOk) {
    restoreEntry();
    return { kind: 'ignored' };
  }
  ctx.publishSourceIngestion(ingested);
  // Reconcile the on-disk universe BEFORE this result is acted on: an
  // unresolved-parent drop whose parent exists on disk (a created file whose
  // watcher event was lost) folds in and re-analyzes here, so the consumer's
  // re-serve is extracted rather than the runtime fallback (openspec:
  // dev-transform-coherence, "Source-universe reconciliation precedes
  // unresolved-parent fallbacks"). The plan diff below spans the WHOLE
  // transaction, so a stabilization re-analysis needs no extra bookkeeping;
  // the single system-props compare below spans it for the same reason.
  // Stabilization re-analyzes, and `runAnalysis` throws in EVERY mode on
  // error diagnostics (the escalation is deliberately outside its non-strict
  // catch). That throw would otherwise escape past `restoreEntry`, leaving
  // the cache advanced to this content — so re-saving the corrected file
  // byte-identically would hit the unchanged-hash gate and never re-analyze.
  try {
    await stabilizeSourceUniverse(ctx);
  } catch (e) {
    restoreEntry();
    throw e;
  }
  const systemPropsChanged = systemPropsModuleSource(ctx) !== systemPropsBefore;
  const analysisMs = Math.round(performance.now() - analysisStart);

  // Definition files whose file plan changed — replacement content,
  // membership, and raw↔extracted (absent↔present) transitions all count
  // (openspec: dev-transform-coherence). The changed file itself is already
  // in every environment's module list, so it is filtered by resolved path
  // (not by cache key — MDX plans carry the `.tsx`-suffixed key).
  const staleDefinitionFiles = diffFilePlans(
    prevPlans,
    snapshotFilePlans(ctx.storedManifest)
  ).filter((defFile) => resolve(ctx.rootDir, defFile) !== absFile);

  const nativeEntry = ingested.analysisEntries.find(
    (entry) => entry.path === relPath
  );
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

/**
 * True when the changed file's transform output is byte-identical across the
 * edit — a presentation-only change (style values are not part of the emitted
 * replacement, whose class names hash `filename::binding`).
 *
 * Compares a POST-analysis re-transform of the file (the engine transforms
 * from its retained facts, so this runs against the just-updated analysis)
 * with the hash of what the module LAST SERVED (`recordTransformOutput` in
 * the transform hook, bridge import included). Comparing the full served
 * output — never replacement strings — is what keeps a mixed style+code edit
 * deliverable. Fails open: a transform error, a file the manifest does not
 * list, or a module that never served (no recorded hash) delivers normally.
 */
function isPresentationOnlyEdit(
  ctx: PluginContext,
  scannerRelPath: string,
  source: string
): boolean {
  const servedHash = ctx.transformOutputHashes.get(scannerRelPath);
  if (!servedHash || !ctx.storedManifestJson) return false;
  if (!ctx.storedManifest?.files?.[scannerRelPath]?.length) return false;
  try {
    const { transformFile } = ctx.engineApi();
    const fresh = transformFile(source, scannerRelPath, ctx.storedManifestJson);
    if (!fresh.hasComponents) return false;
    return contentHash(applyDevBridgeImport(fresh.code)) === servedHash;
  } catch {
    return false;
  }
}

/**
 * Reconcile a deleted file in dev.
 *
 * Without this the removed file's last-known source stays in `ctx.fileCache`,
 * and shared source ingestion re-feeds that ghost original to the engine on
 * every later re-analysis — the deleted component's CSS survives for the life
 * of the process.
 */
async function pruneDeletedFile(
  ctx: PluginContext,
  absFile: string
): Promise<void> {
  const relPath = relative(ctx.rootDir, absFile);
  const cached = ctx.fileCache.get(relPath);
  if (!cached || !pruneFileCache(ctx.fileCache, ctx.rootDir, absFile)) return;

  const prevPlans = snapshotFilePlans(ctx.storedManifest);
  // A failed re-analysis after a delete must NOT restore the cache entry:
  // a delete fires exactly one watcher event, so a re-inserted entry is the
  // very ghost this function exists to prevent — no retry event will ever
  // name it again, and nothing validates the cache against disk. On failure
  // the last-good manifest keeps serving (its residual CSS is the lesser
  // debt; the next successful analysis of any kind prunes it, since the
  // deleted key is already out of the cache).
  let ingested = await ctx.ingestRawSources(
    buildRawEntriesFromCache(ctx.fileCache)
  );
  // Per-file quarantine, buildStart parity: an unrelated invalid original
  // must not abort the prune's re-analysis.
  ingested = withoutInvalidOriginals(
    ingested,
    ctx.surfaceSourceDiagnostics(ingested.diagnostics)
  );
  const ok = ctx.runAnalysis(ingested.analysisEntries) !== false;
  if (!ok) return;
  ctx.publishSourceIngestion(ingested);
  ctx.log(`Deleted file pruned: ${relative(ctx.rootDir, absFile)}`);

  // A consumer whose extracted entries disappeared with the deleted parent
  // is an ordinary plan change — its modules re-deliver like any other
  // (openspec: hmr-new-file-detection, "Consumers of a deleted parent are
  // invalidated"). No exclusion: evicting the deleted file's own residual
  // nodes is harmless and closes the delete→recreate-same-path window.
  invalidateFileModules(
    ctx,
    diffFilePlans(prevPlans, snapshotFilePlans(ctx.storedManifest))
  );

  // Unconditional, symmetric with creation (openspec: hmr-new-file-detection,
  // "CSS invalidation after new file analysis").
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
  analyzed: Extract<HotUpdateResult, { kind: 'analyzed' }>
): EnvironmentModuleNode[] | void {
  const graph = environment.moduleGraph;
  // Presentation-only edits (byte-identical transform output) exclude the
  // changed file's own modules: a js-update carrying zero new bytes would
  // re-execute the module, mint a fresh createComponent forwardRef, and
  // remount the React subtree — destroying identity, generated IDs, focus,
  // and DOM-owned state (openspec: vite-extraction-plugin, "Presentation-only
  // edits preserve module identity in dev"). CSS still delivers below via
  // the components virtual module.
  const modulesToUpdate = analyzed.presentationOnly ? [] : [...modules];

  // Component CSS (adopted stylesheet in dev, CSS in prod) always; the shared
  // system-props module ONLY when the bytes it serves moved — see the
  // transaction-spanning compare in `analyzeChangedFile` for why.
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
    // The suppressed module was already hard-invalidated by Vite core's
    // onFileChange (before this hook ran). Re-warm its transform result so a
    // later, unrelated update's import analysis doesn't observe an
    // invalidated node and re-import it at a bumped ?t= — which would
    // re-execute the module and break identity AFTER the fact
    // (openspec scenario: "Suppression state survives later unrelated
    // updates"). Fire-and-forget: a failed warm just means the deferred
    // lazy re-transform serves the same bytes on demand.
    for (const mod of modules) {
      // Swallow rejection: a server closing mid-warm (or a transient
      // transform error) must not surface as an unhandled rejection — the
      // deferred lazy re-transform serves the same bytes on demand anyway.
      if (mod.url)
        void environment.transformRequest?.(mod.url)?.catch(() => {});
    }
    // Returning the (possibly virtual-only) set IS the suppression — a void
    // return would let Vite update the changed module by default.
    return modulesToUpdate;
  }

  const invalidated = modulesToUpdate.length - modules.length;
  if (invalidated > 0) {
    ctx.log(`HMR (${environment.name}): ${invalidated} modules invalidated`);
    return modulesToUpdate;
  }
}
