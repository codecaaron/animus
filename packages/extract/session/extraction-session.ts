import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { basename, extname, join, relative, resolve } from 'path';

import {
  assembleStylesheet,
  assertNoErrorDiagnostics,
  buildSystemPropsModule,
  clearEngineCache,
  collectExternalPackageSources,
  contentHash,
  createExcludeMatcher,
  createSourceCorpus,
  createSourceIdentity,
  DEFAULT_EXTENSIONS,
  discoverFiles,
  enforceExternalTokenContracts,
  excludeCollectedPackages,
  extractSystemFilePackages,
  findAssetSpecifiers,
  findPackageRoot,
  firstOwners,
  hashReplacementPlans,
  isExcludedPackageRelativePath,
  isPathWithinRoot,
  loadSystemConfig,
  postProcessCss,
  vocabularyWitnessDiagnostics,
  projectExternalFileOwners,
  resolveAssetFile,
  resolveLightningTargets,
  resolveMode,
  runProjectAnalysis,
  serializeStaticCss,
  sharesVolumeRoot,
  snapshotFilePlans,
  staleDistIncludesMessage,
  substituteAssetPlaceholders,
  toWatchKeys,
  unreadableSourceDiagnostic,
  unresolvableIncludesMessage,
  walkPackageSources,
} from '../pipeline/index';
import {
  checkLockLiveness,
  holdDirectoryClaim,
  readCliLockRecord,
  verifyCommitRecord,
} from './published-set';
import { resolvePackagesByName } from './resolve-packages';
import {
  ANALYSIS_COMMIT_ARTIFACT,
  ANALYSIS_INPUTS_ARTIFACT,
  ANALYSIS_STATUS_ARTIFACT,
  analysisCommitPath,
  ANIMUS_ARTIFACT_DIR,
  ANIMUS_CSS_MODULE_ID,
  CLI_COMMIT_ARTIFACT,
  envelopeCssArtifact,
  envelopeJsonArtifact,
  MANIFEST_ARTIFACT,
  readCssEnvelope,
  readJsonEnvelope,
  REPLACEMENT_EPOCH_ARTIFACT,
  replacementEpochPath,
  SESSION_ASSETS_DIR,
  sessionArtifactDir,
  sessionsRootDir,
  STYLES_ARTIFACT,
  SYSTEM_PROPS_ARTIFACT,
  systemPropsPath,
} from './session-paths';
import {
  claimExclusiveSessionOwner,
  claimProcessSessionId,
  engineApi,
  getOwningWatchSession,
  getWatchTransaction,
  resetAnalysisStartedPromise,
  setOwningWatchSession,
  setAnalysisStartedPromise,
  setAnalyzedHashes,
  setManifestJson,
  setReplacementEpoch,
  setSessionArtifactDir,
  setSharedCss,
  setSharedExternalDirs,
  setSharedExternalEntries,
  setSharedSystemProps,
  setWatchTransaction,
} from './singleton';
import { logBuildTimings } from './timing';

import type {
  AnimusCoreOptions,
  ExternalPackageOutcome,
} from '../pipeline/index';

export type SessionOptions = AnimusCoreOptions;

import type { ExcludeMatcher } from '../pipeline/index';
import type {
  LightningTargets,
  ManifestDiagnostic,
  SourceCorpus,
  SourceIdentity,
  SourceIngestionResult,
  SystemConfig,
} from '../pipeline/index';
import type {
  AnalysisCommit,
  AnalysisStatus,
  SessionEnvelope,
} from './session-paths';

const SESSION_DIR_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const STATUS_WATCHDOG_MS = 2000;

/** Default watcher debounce and the session's status-deadline ceiling.
 *  The watcher entry point defaults its debounce from this — one definition. */
export const DEFAULT_WATCH_DEBOUNCE_MS = 75;

const LEGACY_FLAT_ARTIFACTS = [
  MANIFEST_ARTIFACT,
  ANALYSIS_INPUTS_ARTIFACT,
  STYLES_ARTIFACT,
  SYSTEM_PROPS_ARTIFACT,
  REPLACEMENT_EPOCH_ARTIFACT,
  ANALYSIS_COMMIT_ARTIFACT,
  ANALYSIS_STATUS_ARTIFACT,
] as const;

type FileEntry = { path: string; source: string; hash: string };

export interface WatchChanges {
  modifiedFiles?: ReadonlySet<string>;
  removedFiles?: ReadonlySet<string>;
}

/** `payloadHash` gates rewrites; `diskHash` covers the enveloped disk bytes
 *  and is what the analysis-commit records. */
interface ArtifactWriteRecord {
  payloadHash: string;
  diskHash: string;
}

interface SessionArtifactRecords {
  manifest: ArtifactWriteRecord | null;
  inputs: ArtifactWriteRecord | null;
  styles: ArtifactWriteRecord | null;
}

/** Brands values read back off DISK. `Object(value) !== value` rejects
 *  boxed primitives; the tag is unspoofable by `Symbol.toStringTag`. */
function isDiskString<Value>(value: Value): value is Value & string {
  return (
    Object(value) !== value &&
    Object.prototype.toString.call(value) === '[object String]'
  );
}

function isDiskNumber<Value>(value: Value): value is Value & number {
  return (
    Object(value) !== value &&
    Object.prototype.toString.call(value) === '[object Number]'
  );
}

/** Bundler-agnostic extraction pipeline: system load, source ingestion,
 *  analysis, emission, and watch-cycle diffing. Carries no bundler types. */
export class ExtractionSession {
  /** Set by the adapter before any pipeline run. */
  rootDir: string | null = null;
  /** Serialized path aliases, harvested by the adapter from bundler config. */
  pathAliasesJson: string | null = null;

  // Per-specifier asset resolve/copy memo — stable per loaded system, so
  // loading a system clears it.
  private assetCopyCache = new Map<
    string,
    {
      sourcePath: string;
      mtimeMs: number;
      size: number;
      fileName: string;
      url: string;
    }
  >();
  /** Physical asset files registered with the host watcher. */
  assetDependencyPaths = new Set<string>();
  private assetDependencyKeys = new Set<string>();
  /** System-props module id override. Turbopack rejects absolute-path
   *  imports, so its driver sets a virtual id; null injects the abs path. */
  systemPropsModuleId: string | null = null;
  /** Whether the analysis-inputs hydration corpus is written to disk. Only
   *  isolated loader workers replay it; an in-process loader reads memory. */
  persistAnalysisInputs = false;

  /** Absolute directory prefixes for external packages (loader allowlist). */
  externalPackageDirs: string[] = [];
  /** Absolute package dir → owning specifier (cross-source correlation). */
  private externalDirOwners: Record<string, string> = {};
  /** rootDir-relative external file → owning specifier (correlation join). */
  private externalFileOwners: Record<string, string> = {};
  /** External package specifier → absolute source entry path. */
  externalSourceEntries = new Map<string, string>();
  /** SourceId authority for this generation — roots realpath'd once per
   *  pipeline; aliases recorded while files exist so deletions resolve. */
  private sourceIdentity: SourceIdentity | null = null;
  /** Canonical admitted external root → declared specifiers; duplicate
   *  specifiers resolving to one canonical root share an entry. */
  externalRootOwners = new Map<string, Set<string>>();
  /** Canonical external root → the extension set its collection walk used
   *  (widened for dist-only roots); rewalks and classification share it. */
  private externalRootExtensions = new Map<string, ReadonlySet<string>>();
  /** Canonical admitted external watch roots — the engine-side watch
   *  surface (webpack contextDependencies / Turbopack watchers). */
  externalWatchRoots: string[] = [];
  /** Canonical external root → sourceKey → {raw content hash, recorded abs}:
   *  the inventory a dirty-root rewalk diffs against, hashed before MDX. */
  private externalInventory = new Map<
    string,
    Map<string, { hash: string; abs: string }>
  >();
  /** Stable key → message, re-surfaced on every full pipeline until the
   *  underlying condition clears. */
  readonly stickyDiagnostics = new Map<string, string>();
  /** Volume-membership predicate for the cross-volume gate. Injected seam:
   *  the real predicate only discriminates on Windows, so tests replace it. */
  sharesProjectVolume: (projectRoot: string, externalRoot: string) => boolean =
    sharesVolumeRoot;
  /** `onExternalRootResolved` fires per admitted root DURING collection,
   *  before its walk; `onExternalRootsCommitted` only after publication. */
  onExternalRootResolved: ((canonicalRoot: string) => void) | null = null;
  onExternalRootsCommitted: ((canonicalRoots: string[]) => void) | null = null;
  /** Fires exactly once per settled `handleWatchUpdate` — the failure cause,
   *  or null when clean. Observation never alters delivery. */
  onCycleSettled: ((cause: unknown) => void) | null = null;

  private readonly options: SessionOptions;
  private readonly staticCssJson: string | null;
  private system: SystemConfig | null = null;
  /** Vocabulary witness diagnostics from the sealed system's registration
   *  record, awaiting the shared surfacing pass. */
  private systemVocabularyDiagnostics: ManifestDiagnostic[] = [];
  /** Configured external files that could not be read. Incremental passes
   *  re-collect nothing, so they replay these instead of passing strict. */
  private ingestionFailureDiagnostics: ManifestDiagnostic[] = [];
  /** Full package-resolution map from the last full pipeline — replayed by
   *  incremental passes (sourceEntries alone omits dist-resolved packages). */
  private lastPackageMap: Record<string, string> = {};

  // Raw/original paths and hashes only. Generated MDX/Svelte parser entries
  // live in the published source corpus.
  private fileCache = new Map<string, { hash: string; source: string }>();

  readonly corpus: SourceCorpus = createSourceCorpus({
    engineApi: () => engineApi(),
    prefix: '[animus-next]',
    strict: () => !!this.options.strict,
    warn: (message: string) => this.warn(message),
  });

  // Membership keys (lexical + canonical) for the system's evaluated module
  // files. A failed reload keeps the last set — the stale config still serves.
  private systemDependencyKeys: Set<string> = new Set();

  /** Loader-reported dependency paths for bundler watch registration. */
  systemDependencyPaths: string[] = [];

  // Content hashes at load time — the fallback probe for watch passes that
  // carry no modified/removed sets (webpack's first watchRun).
  private systemDependencyHashes: Map<string, string> = new Map();
  private lastSystemPropsHash: string | null = null;
  private artifactRecords: SessionArtifactRecords = {
    manifest: null,
    inputs: null,
    styles: null,
  };
  /** Last written analysis-commit; null seeds from disk on first use. Its
   *  generation counter is correct only because one session owns the dir. */
  private lastCommit: AnalysisCommit | null = null;
  /** Release handle for the in-process owner slot AND the directory's
   *  on-disk owner record, taken and released as one; null when unheld. */
  private releasePublicationClaim: (() => void) | null = null;
  /** Session identity, claimed once per PROCESS and adopted by every later
   *  session instance so all compilers share one artifact tree. */
  readonly sessionId: string = claimProcessSessionId();
  /** Epoch of the last published analysis; null seeds from disk so a
   *  same-session restart with unchanged plans rewrites no bytes. */
  private lastEpochValue: string | null = null;
  /** Watcher debounce ceiling feeding status deadlines. */
  debounceCeilingMs = DEFAULT_WATCH_DEBOUNCE_MS;
  /** Test seam: observes every session-artifact write (name, content)
   *  post-rename — write ORDER is part of the transaction contract. */
  onArtifactWrite: ((name: string, content: string) => void) | null = null;
  private statusAttemptId = 0;
  private statusAttemptOpen = false;
  /** Monotonic readiness witness: flips true on the first complete
   *  publication and never regresses; every later status write carries it. */
  private firstEmissionComplete = false;
  /** Debounce-window observations pending analysis (sourceKey → hash). */
  private debouncePending = new Map<string, string>();
  private sessionStartHygieneDone = false;
  // Lightning CSS targets — resolved lazily once per session (browserslist
  // config I/O).
  private lcssTargets: LightningTargets | null = null;

  constructor(options: SessionOptions) {
    this.options = options;
    // Serialized once (stable key order) so the analysis-inputs hash is
    // insensitive to option-object identity.
    this.staticCssJson = serializeStaticCss(options.staticCss);
  }

  get sessionDir(): string {
    return sessionArtifactDir(this.rootDir!, this.sessionId);
  }

  get verbose(): boolean {
    return (
      this.options.verbose === true ||
      process.env.ANIMUS_DEBUG === '1' ||
      process.env.ANIMUS_DEBUG === 'true'
    );
  }

  private log(msg: string): void {
    if (this.verbose) {
      // Human-facing session lines go to stderr — stdout belongs to the
      // drivers' machine surfaces.
      console.error(`[animus] ${msg}`);
    }
  }

  private warn(msg: string): void {
    console.warn(`[animus] ${msg}`);
  }

  private now(): number {
    return this.verbose ? performance.now() : 0;
  }
  private elapsed(t: number): number {
    return this.verbose ? Math.round(performance.now() - t) : 0;
  }

  /** Diagnostic prefix label — drivers set their own so one host's errors
   *  never masquerade as another driver's. */
  driverLabel = 'animus-next';

  /** Per-specifier discovery outcomes from the last full collection —
   *  driver-consumed reporting surface (the CLI's summary). */
  lastExternalOutcomes: ExternalPackageOutcome[] = [];

  /** Component count of the last published analysis, null before the first —
   *  read by drivers instead of re-parsing the manifest JSON every cycle. */
  lastComponentCount: number | null = null;

  /** When superseded asset copies leave `assets/`: `'full-pipeline'` suits a
   *  driver serving the dir in place, `'every-cycle'` one republishing it. */
  staleAssetPruning: 'full-pipeline' | 'every-cycle' = 'full-pipeline';

  /** Driver-owned STRUCTURAL exclusions, joined to the never-replaceable set
   *  — never the user list, whose presence flips the replace semantics. */
  structuralExclude: string[] = [];

  private scanConfigMemo: {
    excludeMatcher: ExcludeMatcher;
    extensionsSet: ReadonlySet<string>;
  } | null = null;

  /** Per-pattern exclusion hit counts from this session's matcher —
   *  driver-consumed reporting surface (dead-pattern visibility). */
  getExcludeStats(): ReadonlyMap<string, number> {
    return this.resolveScanConfig().excludeMatcher.stats();
  }

  /** Resolve the scan configuration from options — the single source of the
   *  exclude/extension policy shared by the full and incremental pipelines. */
  private resolveScanConfig(): {
    excludeMatcher: ExcludeMatcher;
    extensionsSet: ReadonlySet<string>;
  } {
    if (this.scanConfigMemo === null) {
      const extensionsSet: ReadonlySet<string> = new Set(
        this.options.extensions ?? DEFAULT_EXTENSIONS
      );
      this.scanConfigMemo = {
        excludeMatcher: createExcludeMatcher(
          this.options.exclude,
          this.structuralExclude
        ),
        extensionsSet,
      };
    }
    return this.scanConfigMemo;
  }

  /** One single-flight analysis transaction per event batch: concurrent
   *  entries join the in-flight promise; each settled entry reports outcome. */
  async handleWatchUpdate(changes: WatchChanges): Promise<void> {
    try {
      await this.routeWatchUpdate(changes);
    } catch (error) {
      // Reported BEFORE the rethrow: observation never changes delivery,
      // but an observer must never learn of a failure after its caller.
      this.onCycleSettled?.(error);
      throw error;
    }
    this.onCycleSettled?.(null);
  }

  private async routeWatchUpdate(changes: WatchChanges): Promise<void> {
    const inflight = getWatchTransaction();
    if (inflight) {
      await inflight;
      return;
    }

    // Non-owning instance: each compiler child watches its own files, so a
    // batch only this one observes is forwarded, never dropped.
    if (!this.system) {
      const owner = getOwningWatchSession();
      const hasBatch =
        (changes.modifiedFiles?.size ?? 0) > 0 ||
        (changes.removedFiles?.size ?? 0) > 0;
      if (owner && owner !== this && hasBatch) {
        await owner.ingestForwardedBatch(changes);
      }
      return;
    }

    const transaction = this.processWatchUpdate(changes);
    setWatchTransaction(transaction);
    try {
      await transaction;
    } finally {
      setWatchTransaction(null);
    }
  }

  /** Owner-side entry for a batch a non-owning compiler observed. Serializes
   *  behind any in-flight transaction — it has no other delivery. */
  async ingestForwardedBatch(changes: WatchChanges): Promise<void> {
    if (!this.system) return;
    for (;;) {
      const inflight = getWatchTransaction();
      if (!inflight) break;
      await inflight;
    }
    const transaction = this.processWatchUpdate(changes);
    setWatchTransaction(transaction);
    try {
      await transaction;
    } finally {
      setWatchTransaction(null);
    }
  }

  private async processWatchUpdate(changes: WatchChanges): Promise<void> {
    const rootDir = this.rootDir!;

    // Reconciliation runs FIRST: a bare directory report cannot be
    // classified, so classification below sees only concrete file paths.
    try {
      changes = this.reconcileExternalRoots(changes);
    } catch (err) {
      this.warn(`external root reconciliation failed: ${String(err)}`);
    }

    const changed = [
      ...(changes.modifiedFiles ?? []),
      ...(changes.removedFiles ?? []),
    ];

    // System reload: any changed or removed file in the system's evaluated
    // module set. Keys are lexical and canonical, so symlinked paths match.
    let assetChanged = false;
    let systemHit: string | undefined;
    try {
      if (!changes.modifiedFiles && !changes.removedFiles) {
        // No change sets (webpack's first watchRun): probe the dependency
        // files by content hash.
        for (const [dep, hash] of this.systemDependencyHashes) {
          let current = '';
          try {
            current = contentHash(readFileSync(dep, 'utf-8'));
          } catch {
            // unreadable/deleted → hash stays '' and mismatches a real one
          }
          if (current !== hash) {
            systemHit = dep;
            break;
          }
        }
      } else {
        systemHit = changed.find((path) =>
          toWatchKeys(path).some((key) => this.systemDependencyKeys.has(key))
        );
      }
    } catch (err) {
      // Detection-only failure: degrade to the ordinary incremental diff.
      this.warn(`HMR system-reload check failed: ${String(err)}`);
    }

    if (systemHit) {
      this.log(
        `system reload: system dependency changed (${relative(rootDir, systemHit)})`
      );
      this.resetForHmr();
      try {
        const promise = this.runFullPipeline(this.pendingFromBatch(changes));
        setAnalysisStartedPromise(promise);
        await promise;
      } catch (err) {
        // A failed reset re-run is a failed cycle, not a fallback: swallowing
        // it would republish against the stale system.
        try {
          this.beginStatusAttempt();
          this.writeAnalysisStatus(
            'failed',
            this.pendingFromBatch(changes),
            String(err)
          );
        } catch (statusErr) {
          // A failed status write (EMFILE/ENOSPC) must not mask the cycle
          // failure itself.
          this.warn(`failed-status write failed: ${String(statusErr)}`);
        }
        throw err;
      }
      return;
    }

    if (
      changed.some((path) =>
        toWatchKeys(path).some((key) => this.assetDependencyKeys.has(key))
      )
    ) {
      // The batch may also carry component edits: fall through to the shared
      // read/re-hash flow, or a stale entry never re-surfaces.
      this.assetCopyCache.clear();
      assetChanged = true;
    }

    const { excludeMatcher, extensionsSet } = this.resolveScanConfig();

    // Prior cache entries for every path this batch touches — restored on
    // failure, or a poisoned hash would suppress the equal-content retry.
    const priorCacheEntries = new Map<
      string,
      { hash: string; source: string } | null
    >();
    const priorExternalFileOwners = { ...this.externalFileOwners };
    const recordPrior = (key: string) => {
      if (!priorCacheEntries.has(key)) {
        priorCacheEntries.set(key, this.fileCache.get(key) ?? null);
      }
    };

    // External-inventory mutations, applied only after the analysis
    // publishes, so a failed attempt reconciles the same delta again.
    const inventoryUpdates: Array<{
      root: string;
      key: string;
      hash: string | null;
      abs: string;
    }> = [];
    // Owner records for deleted files, deferred the same way: a rolled-back
    // cache entry with no owner loses its token diagnostics for the session.
    const ownerRemovals: string[] = [];

    // Prune deleted/renamed files so their last source stops riding along.
    // Out-of-root deletions resolve through cached identity only.
    let removedAny = false;
    if (changes.removedFiles) {
      for (const removedPath of changes.removedFiles) {
        let key: string;
        let owningRoot: string | null = null;
        if (isPathWithinRoot(rootDir, removedPath)) {
          key = relative(rootDir, removedPath);
        } else {
          const resolved =
            this.sourceIdentity?.resolveDeletedSourceId(removedPath);
          if (!resolved) continue;
          key = resolved.sourceKey;
          owningRoot = resolved.owningRoot;
        }
        recordPrior(key);
        if (this.fileCache.delete(key)) {
          removedAny = true;
          if (owningRoot) {
            inventoryUpdates.push({
              root: owningRoot,
              key,
              hash: null,
              abs: removedPath,
            });
            ownerRemovals.push(key, key + '.tsx');
          }
        }
      }
    }

    let targets: Array<{ abs: string; key: string; owningRoot: string | null }>;
    if (changes.modifiedFiles) {
      targets = [];
      for (const modifiedPath of changes.modifiedFiles) {
        const classified = this.classifyWatchPath(modifiedPath, {
          excludeMatcher,
          extensionsSet,
        });
        if (classified) targets.push({ abs: modifiedPath, ...classified });
      }
    } else {
      targets = discoverFiles(
        rootDir,
        rootDir,
        excludeMatcher,
        extensionsSet
      ).map((abs) => ({ abs, key: relative(rootDir, abs), owningRoot: null }));
    }

    const changedPaths: string[] = [];

    for (const target of targets) {
      const relPath = target.key;
      let source: string;
      try {
        source = readFileSync(target.abs, 'utf-8');
      } catch {
        // Benign race: the file vanished between the watch event and this
        // read — it will surface in removedFiles on the next watch cycle.
        continue;
      }
      // Raw bytes hash — the inventory's diff basis for external files.
      const rawHash = contentHash(source);

      const cached = this.fileCache.get(relPath);
      const hash = rawHash;

      if (!cached || cached.hash !== hash) {
        changedPaths.push(relPath);
        recordPrior(relPath);
        this.fileCache.set(relPath, { hash, source });
        if (target.owningRoot) {
          // Ownership recorded before the analysis, which correlates
          // diagnostics against it: most-specific root, first specifier.
          const owner = this.externalRootOwners
            .get(target.owningRoot)
            ?.values()
            .next().value;
          if (owner !== undefined) {
            this.externalFileOwners[relPath] ??= owner;
          }
          inventoryUpdates.push({
            root: target.owningRoot,
            key: target.key,
            hash: rawHash,
            abs: target.abs,
          });
        }
      }
    }

    if (changedPaths.length > 0 || removedAny || assetChanged) {
      const pending: Array<[string, string]> = changedPaths.map((rel) => [
        rel,
        this.fileCache.get(rel)!.hash,
      ]);

      let ingested: SourceIngestionResult;
      try {
        this.beginStatusAttempt();
        // Dropping a quarantined file beats aborting the batch: an aborted
        // batch writes 'idle' and leaves waiting loaders unscheduled.
        ingested = await this.corpus.prepare({
          fileCache: this.fileCache,
          externalFileOwners: this.externalFileOwners,
        });
        this.externalFileOwners = projectExternalFileOwners(
          ingested,
          this.externalFileOwners
        );

        resetAnalysisStartedPromise();
        const promise = this.runIncrementalPipeline(
          ingested.analysisEntries,
          pending
        );
        setAnalysisStartedPromise(promise);
        await promise;
      } catch (err) {
        // Roll the cache back: the failed attempt published nothing, so the
        // same content must analyze again on the next observation.
        for (const [key, prior] of priorCacheEntries) {
          if (prior === null) this.fileCache.delete(key);
          else this.fileCache.set(key, prior);
        }
        this.externalFileOwners = priorExternalFileOwners;
        if (this.statusAttemptOpen) {
          this.debouncePending.clear();
          this.writeAnalysisStatus('failed', pending, String(err));
        }
        throw err;
      }
      this.publishSourceIngestion(ingested);
      for (const update of inventoryUpdates) {
        let inventory = this.externalInventory.get(update.root);
        if (!inventory) {
          inventory = new Map();
          this.externalInventory.set(update.root, inventory);
        }
        if (update.hash === null) inventory.delete(update.key);
        else inventory.set(update.key, { hash: update.hash, abs: update.abs });
      }
      for (const key of ownerRemovals) {
        delete this.externalFileOwners[key];
      }
    } else if (this.statusAttemptOpen) {
      // A debounced burst produced nothing analyzable — close the attempt so
      // no loader waits on a status that never commits.
      this.debouncePending.clear();
      this.writeAnalysisStatus('idle', []);
    }
  }

  private publishSourceIngestion(result: SourceIngestionResult): void {
    this.fileCache = new Map(
      result.originalEntries.map((entry) => [
        entry.path,
        { hash: entry.hash, source: entry.source },
      ])
    );
    this.corpus.publish(result);
  }

  /** Full analysis + publication, registered in the one in-flight
   *  transaction slot; a nested reload leaves the enclosing registration. */
  async runFullPipeline(pending: Array<[string, string]> = []): Promise<void> {
    // Publication exclusivity is the pipeline's claim, so the per-instance
    // write guards hold by construction. Re-entrant for this instance.
    if (this.releasePublicationClaim === null) {
      const releaseOwner = claimExclusiveSessionOwner(
        `${this.driverLabel}:${this.sessionDir}`
      );
      // The on-disk record is what stops a sibling from pruning this tree.
      // Only the in-process winner writes it, and both release together.
      mkdirSync(this.sessionDir, { recursive: true });
      const releaseClaimRecord = holdDirectoryClaim(this.sessionDir);
      this.releasePublicationClaim = () => {
        releaseOwner();
        releaseClaimRecord();
      };
    }

    // Ownership is decided by whether `system` is set, so a failed pass must
    // restore it — otherwise this session answers as owner with empty caches.
    const priorSystem = this.system;

    const nested = getWatchTransaction() !== null;
    const transaction = this.runPipelineTransaction(pending);
    if (!nested) setWatchTransaction(transaction);
    try {
      await transaction;
    } catch (error) {
      this.system = priorSystem;
      throw error;
    } finally {
      if (!nested) setWatchTransaction(null);
    }
  }

  private async runPipelineTransaction(
    pending: Array<[string, string]>
  ): Promise<void> {
    const pipelineStart = this.now();
    const bt: Record<string, number> = {};

    // Hygiene first, then publish this session's artifact dir for the
    // in-process loader before any analysis can complete.
    this.runSessionStartHygiene();
    setSessionArtifactDir(this.sessionDir);

    const rootDir = this.rootDir!;
    const priorSourceState = this.snapshotSourceState();
    const resolvedSystemPath = resolve(rootDir, this.options.system);

    let t = this.now();
    this.system = loadSystemConfig(engineApi, {
      systemPath: resolvedSystemPath,
      rootDir,
      prefix: this.options.prefix,
    });
    // The loader's evaluation host shims console, so the sealed record is
    // the witness channel for these diagnostics.
    this.systemVocabularyDiagnostics = vocabularyWitnessDiagnostics(
      this.system.vocabularyWitnessesJson
    );
    this.assetCopyCache.clear();
    this.assetDependencyPaths.clear();
    this.assetDependencyKeys.clear();
    {
      const deps = this.system.dependencies ?? [];
      const keys = new Set<string>();
      for (const key of toWatchKeys(resolvedSystemPath)) keys.add(key);
      for (const dep of deps) {
        for (const key of toWatchKeys(dep)) keys.add(key);
      }
      this.systemDependencyKeys = keys;
      this.systemDependencyPaths = deps;

      const hashes = new Map<string, string>();
      for (const dep of deps.length > 0 ? deps : [resolvedSystemPath]) {
        try {
          hashes.set(dep, contentHash(readFileSync(dep, 'utf-8')));
        } catch {
          // Unreadable now → the probe treats any later readability
          // change as a system change.
          hashes.set(dep, '');
        }
      }
      this.systemDependencyHashes = hashes;
    }
    bt.systemLoad = this.elapsed(t);

    t = this.now();
    const { excludeMatcher, extensionsSet } = this.resolveScanConfig();
    const files = discoverFiles(
      rootDir,
      rootDir,
      excludeMatcher,
      extensionsSet
    );

    bt.fileDiscovery = this.elapsed(t);

    // Local and external discovery establish one complete resolver index
    // before shared adaptation runs.
    t = this.now();
    const rawEntries: FileEntry[] = [];
    for (const filePath of files) {
      const source = readFileSync(filePath, 'utf-8');
      const relPath = relative(rootDir, filePath);
      const hash = contentHash(source);
      rawEntries.push({ path: relPath, source, hash });
    }

    bt.fileRead = this.elapsed(t);

    // Workspace walk + require.resolve stays local (the Node-resolution
    // seam); the traversal and ingest below are the shared collector.
    t = this.now();
    const packageNames = extractSystemFilePackages(resolvedSystemPath);
    const preResolved = resolvePackagesByName(rootDir, packageNames);

    // Raw content hashes of every walked external file, keyed by absolute
    // path — recorded before MDX preprocessing so the diff sees raw bytes.
    const rawExternalFiles = new Map<string, string>();

    // Published only once collection completes, so a throw in between leaves
    // the previous generation's set in place.
    const ingestionFailures: ManifestDiagnostic[] = [];

    const collected = await collectExternalPackageSources({
      specifiers: packageNames,
      resolveSpecifier: (name) =>
        preResolved[name] ? resolve(rootDir, preResolved[name]) : null,
      rootDir,
      extensionsSet,
      hasEntry: (relPath) => rawEntries.some((e) => e.path === relPath),
      onSourceRead: (source, _relPath, absPath) => {
        rawExternalFiles.set(absPath, contentHash(source));
      },
      onUnreadable: (relPath, err) =>
        // A configured file that cannot be read is lost input, not
        // degradation: error severity fails a strict build.
        ingestionFailures.push(unreadableSourceDiagnostic(relPath, err)),
      onPackageResolved: (_specifier, packageDir) => {
        if (!this.onExternalRootResolved) return;
        // The cross-volume gate runs after collection, so the predicate also
        // gates this phase — a rejected root must never be watched.
        if (!this.sharesProjectVolume(rootDir, packageDir)) return;
        let canonical = packageDir;
        try {
          canonical = realpathSync(packageDir);
        } catch {
          // Unreadable root — the host's registration degrades per-root.
        }
        this.onExternalRootResolved(canonical);
      },
    });

    this.lastExternalOutcomes = collected.outcomes;
    this.ingestionFailureDiagnostics = ingestionFailures;

    for (const record of collected.outcomes) {
      if (record.outcome === 'empty') {
        this.warn(
          `include '${record.specifier}' resolved but discovered no component sources`
        );
      }
    }
    const unresolvableMessage = unresolvableIncludesMessage(collected.outcomes);
    if (unresolvableMessage !== null) {
      if (this.options.strict) {
        throw new Error(unresolvableMessage);
      }
      this.warn(unresolvableMessage);
    }
    // A stale dist entry rides the same strict/warn seam: merging against it
    // skews registry content away from the discovered sources.
    const staleDistMessage = staleDistIncludesMessage(collected.outcomes);
    if (staleDistMessage !== null) {
      if (this.options.strict) {
        throw new Error(staleDistMessage);
      }
      this.warn(staleDistMessage);
    }

    // A source root on a different volume than the project root is rejected
    // AT DISCOVERY — never lazily at event time.
    const rejectedSpecifiers = new Set<string>();
    const crossVolumeDetails: string[] = [];
    for (const [dir, specifiers] of Object.entries(collected.dirOwnerSets)) {
      if (this.sharesProjectVolume(rootDir, dir)) continue;
      for (const specifier of specifiers) rejectedSpecifiers.add(specifier);
      crossVolumeDetails.push(`${specifiers.join(', ')} → ${dir}`);
    }
    this.stickyDiagnostics.delete('cross-volume');
    if (rejectedSpecifiers.size > 0) {
      const message =
        `ANIMUS_EXTERNAL_CROSS_VOLUME_UNSUPPORTED: external package source ` +
        `root(s) on a different volume than the project root (${rootDir}): ` +
        `${crossVolumeDetails.join('; ')} — cross-volume workspace sources ` +
        `are unsupported; the package(s) are excluded from extraction and watching`;
      if (this.options.strict) {
        throw new Error(`[${this.driverLabel}] ${message}`);
      }
      this.stickyDiagnostics.set('cross-volume', message);
    }
    for (const message of this.stickyDiagnostics.values()) {
      this.warn(message);
    }
    const admitted = excludeCollectedPackages(
      collected,
      rejectedSpecifiers,
      rootDir
    );

    try {
      const identity = createSourceIdentity(rootDir);
      this.externalRootOwners = new Map();
      this.externalRootExtensions = new Map();
      for (const [dir, specifiers] of Object.entries(admitted.dirOwnerSets)) {
        const canonical = identity.registerExternalRoot(dir);
        const owners = this.externalRootOwners.get(canonical) ?? new Set();
        for (const specifier of specifiers) owners.add(specifier);
        this.externalRootOwners.set(canonical, owners);
        // The rewalk and watch classification MUST use this same set, or a
        // widened root's files reconcile as a total deletion.
        const exts = admitted.dirExtensions[dir];
        if (exts) this.externalRootExtensions.set(canonical, new Set(exts));
      }
      this.sourceIdentity = identity;
      this.externalWatchRoots = identity.externalRoots();
      this.externalInventory = new Map();
      for (const [absPath, rawHash] of rawExternalFiles) {
        const resolved = identity.resolveSourceId(absPath);
        if (!resolved?.owningRoot) continue;
        let inventory = this.externalInventory.get(resolved.owningRoot);
        if (!inventory) {
          inventory = new Map();
          this.externalInventory.set(resolved.owningRoot, inventory);
        }
        inventory.set(resolved.sourceKey, { hash: rawHash, abs: absPath });
      }

      const packageMap = admitted.packageMap;
      this.lastPackageMap = packageMap;
      this.externalDirOwners = firstOwners(admitted.dirOwnerSets);
      this.externalFileOwners = admitted.fileOwners;
      this.externalSourceEntries = admitted.sourceEntries;
      for (const entry of admitted.entries) {
        const hash = contentHash(entry.source);
        rawEntries.push({ path: entry.path, source: entry.source, hash });
      }

      this.externalPackageDirs = admitted.packageDirs;

      bt.packageResolve = this.elapsed(t);

      this.beginStatusAttempt();
      let accepted: SourceIngestionResult;
      try {
        accepted = await this.corpus.prepare(rawEntries);
      } catch (err) {
        this.debouncePending.clear();
        this.writeAnalysisStatus('failed', pending, String(err));
        throw err;
      }
      this.externalFileOwners = projectExternalFileOwners(
        accepted,
        this.externalFileOwners
      );
      bt.fileCount = accepted.analysisEntries.length;
      // Clear the native cache only after adaptation produced a corpus: a
      // failed reload must leave the last-good transform engine usable.
      clearEngineCache(engineApi);
      await this.analyzeAndEmit(
        accepted.analysisEntries,
        packageMap,
        false,
        bt,
        pipelineStart,
        pending
      );
      this.publishSourceIngestion(accepted);

      // External package state publishes in the same successful generation
      // as the source projection.
      setSharedExternalDirs(admitted.packageDirs);
      setSharedExternalEntries(admitted.sourceEntries);

      this.onExternalRootsCommitted?.(this.externalWatchRoots);

      // Registered only on SUCCESS: a failed pipeline leaves no owner that
      // would accept batches it cannot analyze.
      setOwningWatchSession(this);
    } catch (err) {
      this.restoreSourceState(priorSourceState);
      throw err;
    }
  }

  /** Per-generation source state captured as ONE object so the restore
   *  cannot omit a member; deep-copied fields are mutated in place. */
  private snapshotSourceState() {
    return {
      sourceIdentity: this.sourceIdentity,
      externalRootOwners: new Map(
        [...this.externalRootOwners].map(([root, owners]) => [
          root,
          new Set(owners),
        ])
      ),
      externalRootExtensions: new Map(this.externalRootExtensions),
      externalWatchRoots: [...this.externalWatchRoots],
      externalInventory: new Map(
        [...this.externalInventory].map(([root, inventory]) => [
          root,
          new Map(inventory),
        ])
      ),
      lastPackageMap: this.lastPackageMap,
      externalDirOwners: this.externalDirOwners,
      externalFileOwners: this.externalFileOwners,
      externalSourceEntries: this.externalSourceEntries,
      externalPackageDirs: this.externalPackageDirs,
      systemVocabularyDiagnostics: this.systemVocabularyDiagnostics,
      ingestionFailureDiagnostics: this.ingestionFailureDiagnostics,
    };
  }

  private restoreSourceState(
    snapshot: ReturnType<ExtractionSession['snapshotSourceState']>
  ): void {
    Object.assign(this, snapshot);
  }

  /** Release this session's publication claim so a successor may publish.
   *  Idempotent, and scoped to this session's own claim. */
  close(): void {
    this.releasePublicationClaim?.();
    this.releasePublicationClaim = null;
  }

  /** Reset analysis state for a system reload: write guards go back to null
   *  and reseed from the disk envelopes on the next publication. */
  resetForHmr(): void {
    resetAnalysisStartedPromise();
    this.artifactRecords = { manifest: null, inputs: null, styles: null };
    this.lastSystemPropsHash = null;
  }

  /** The (sourceKey, observed hash) pairs of a watch batch — the status
   *  file's pending set; loaders wait only on observed inputs. */
  private pendingFromBatch(changes: WatchChanges): Array<[string, string]> {
    const { excludeMatcher, extensionsSet } = this.resolveScanConfig();
    const pending: Array<[string, string]> = [];
    for (const path of changes.modifiedFiles ?? []) {
      const classified = this.classifyWatchPath(path, {
        excludeMatcher,
        extensionsSet,
      });
      if (!classified) continue;
      try {
        pending.push([
          classified.key,
          contentHash(readFileSync(path, 'utf-8')),
        ]);
      } catch {
        // vanished between event and read — surfaces as removed next cycle
      }
    }
    return pending;
  }

  /** Rewalk dirty external roots and diff the inventory into created,
   *  edited and deleted deltas: a watcher may report only the directory. */
  private reconcileExternalRoots(changes: WatchChanges): WatchChanges {
    const identity = this.sourceIdentity;
    if (!identity) return changes;
    if (!changes.modifiedFiles && !changes.removedFiles) return changes;
    if (this.externalWatchRoots.length === 0) return changes;

    const { extensionsSet } = this.resolveScanConfig();
    const dirtyRoots = new Set<string>();
    const modified = new Set<string>();
    const removed = new Set<string>();

    // Only directories — or vanished paths with no recorded file identity —
    // mark their root dirty; a file event is never a root hit.
    const rootHitFor = (path: string): string | null => {
      const containing = identity.containingExternalRoot(path);
      if (!containing) return null;
      try {
        return statSync(path).isDirectory() ? containing : null;
      } catch {
        return identity.resolveDeletedSourceId(path) ? null : containing;
      }
    };

    for (const path of changes.modifiedFiles ?? []) {
      const root = rootHitFor(path);
      if (root) dirtyRoots.add(root);
      else modified.add(path);
    }
    for (const path of changes.removedFiles ?? []) {
      const root = rootHitFor(path);
      if (root) dirtyRoots.add(root);
      else removed.add(path);
    }

    for (const root of dirtyRoots) {
      const previous =
        this.externalInventory.get(root) ??
        new Map<string, { hash: string; abs: string }>();
      const seen = new Set<string>();
      // The rewalk IS the collection walk, down to the root's recorded
      // extension set; the project default sees nothing under a dist root.
      const walked = walkPackageSources(
        root,
        this.externalRootExtensions.get(root) ?? extensionsSet
      );
      if (walked.length === 0 && previous.size > 0) {
        // A vacuous rewalk of a populated root is how policy drift presents
        // — loud before the diff reconstructs every entry as a deletion.
        this.warn(
          `external root rewalk found no files under ${root} while its ` +
            `inventory holds ${previous.size} — reconciling as full deletion`
        );
      }
      for (const abs of walked) {
        const resolved = identity.resolveSourceId(abs);
        // Files claimed by a different (nested) root reconcile with THAT
        // root's dirty pass; escapes resolve to null and never enter.
        if (!resolved || resolved.owningRoot !== root) continue;
        seen.add(resolved.sourceKey);
        let rawHash: string;
        try {
          rawHash = contentHash(readFileSync(abs, 'utf-8'));
        } catch {
          continue;
        }
        if (previous.get(resolved.sourceKey)?.hash !== rawHash) {
          modified.add(abs);
        }
      }
      for (const [key, entry] of previous) {
        // Reconstructed deletions carry the RECORDED spelling, so the
        // removal path resolves them through cached identity.
        if (!seen.has(key)) removed.add(entry.abs);
      }
    }

    return { modifiedFiles: modified, removedFiles: removed };
  }

  /** Route one watcher path: a project-root member (consumer excludes apply)
   *  or an admitted external member (symlink escapes rejected). */
  private classifyWatchPath(
    absPath: string,
    scan: { excludeMatcher: ExcludeMatcher; extensionsSet: ReadonlySet<string> }
  ): { key: string; owningRoot: string | null } | null {
    const ext = extname(absPath);
    const rootDir = this.rootDir!;
    if (isPathWithinRoot(rootDir, absPath)) {
      if (!scan.extensionsSet.has(ext)) return null;
      const rel = relative(rootDir, absPath);
      if (scan.excludeMatcher.matches(absPath, rel)) {
        return null;
      }
      return { key: rel, owningRoot: null };
    }
    // External paths gate on their owning root's extension set, so identity
    // resolves first — the project set would drop a dist-only kit's edits.
    const resolved = this.sourceIdentity?.resolveSourceId(absPath);
    if (!resolved) return null;
    if (resolved.owningRoot === null) {
      // An out-of-root spelling canonicalizing INTO the project root —
      // the same consumer filters as the lexical local branch.
      if (!scan.extensionsSet.has(ext)) return null;
      if (scan.excludeMatcher.matches(resolved.sourceKey, resolved.sourceKey)) {
        return null;
      }
      return { key: resolved.sourceKey, owningRoot: null };
    }
    const rootExtensions =
      this.externalRootExtensions.get(resolved.owningRoot) ??
      scan.extensionsSet;
    if (!rootExtensions.has(ext)) return null;
    if (isExcludedPackageRelativePath(resolved.pathInRoot)) {
      return null;
    }
    return { key: resolved.sourceKey, owningRoot: resolved.owningRoot };
  }

  private async runIncrementalPipeline(
    fileEntries: FileEntry[],
    pending: Array<[string, string]> = []
  ): Promise<void> {
    const bt: Record<string, number> = {};
    const pipelineStart = this.now();

    await this.analyzeAndEmit(
      fileEntries,
      this.lastPackageMap,
      true,
      bt,
      pipelineStart,
      pending
    );
  }

  /** Shared analysis + emit core for both pipelines. `devMode` forks only
   *  the report log and the system-props write guard. */
  private async analyzeAndEmit(
    fileEntries: FileEntry[],
    packageMap: Record<string, string>,
    devMode: boolean,
    bt: Record<string, number>,
    pipelineStart: number,
    pending: Array<[string, string]> = []
  ): Promise<void> {
    this.beginStatusAttempt();
    this.debouncePending.clear();
    this.writeAnalysisStatus('starting', pending);
    try {
      await this.analyzeAndEmitAttempt(
        fileEntries,
        packageMap,
        devMode,
        bt,
        pipelineStart,
        pending
      );
      // The readiness witness flips BEFORE the terminal status write, so the
      // first 'idle' after first emission already carries `ready`.
      this.firstEmissionComplete = true;
      this.writeAnalysisStatus('idle', []);
    } catch (err) {
      // Failed analyses publish no partial generation: nothing above advanced
      // an artifact, and the status carries the diagnostic.
      this.writeAnalysisStatus('failed', pending, String(err));
      throw err;
    }
  }

  /** An explicit `mode` wins over the pipeline path: a pinned-production
   *  watch must not emit unpruned CSS on its first incremental republish. */
  private engineDevMode(pipelineDefault: boolean): boolean {
    if (this.options.mode !== undefined) {
      return this.options.mode === 'development';
    }
    return pipelineDefault;
  }

  private async analyzeAndEmitAttempt(
    fileEntries: FileEntry[],
    packageMap: Record<string, string>,
    devMode: boolean,
    bt: Record<string, number>,
    pipelineStart: number,
    pending: Array<[string, string]>
  ): Promise<void> {
    const system = this.system!;

    const analysisOptions = {
      fileEntries,
      packageMap,
      system,
      emitter: {
        runtimeImport: '@animus-ui/system/runtime',
        cssModuleId: ANIMUS_CSS_MODULE_ID,
        systemPropsModuleId:
          this.systemPropsModuleId ?? systemPropsPath(this.sessionDir),
      },
      pathAliasesJson: this.pathAliasesJson,
      staticCssJson: this.staticCssJson,
      externalDirs: this.externalPackageDirs.map((dir) =>
        relative(this.rootDir!, dir)
      ),
      devMode: this.engineDevMode(devMode),
    };

    this.writeAnalysisStatus('analyzing', pending);
    const result = runProjectAnalysis(engineApi, {
      ...analysisOptions,
      warn: (message) => this.warn(message),
      strict: this.options.strict,
      extraDiagnostics: [
        ...this.systemVocabularyDiagnostics,
        ...this.ingestionFailureDiagnostics,
      ],
    });

    // Throws on any error diagnostic in EVERY mode, before token contracts
    // and before any stylesheet is assembled — no partial generation.
    assertNoErrorDiagnostics(result.manifest?.diagnostics);

    enforceExternalTokenContracts({
      diagnostics: result.manifest?.diagnostics,
      fileOwners: this.externalFileOwners,
      dirOwners: this.externalDirOwners,
      sourceThemeManifestsJson: system.sourceThemeManifestsJson,
      strict: this.options.strict,
      prefix: `[${this.driverLabel}]`,
      warn: (message: string) => this.warn(message),
    });

    bt.jsonSerialize = result.timings.serializeMs;
    bt.rustExtract = result.timings.extractMs;
    bt.jsonParse = result.timings.parseMs;

    const manifest = result.manifest;
    this.lastComponentCount = Object.keys(manifest?.components ?? {}).length;

    if (!devMode) {
      bt.analysis =
        (bt.jsonSerialize ?? 0) + (bt.rustExtract ?? 0) + (bt.jsonParse ?? 0);
      if (manifest?.report) {
        this.log(
          `Extracted ${manifest.report.components_extracted ?? '?'}/${manifest.report.components_total ?? '?'} components (${bt.analysis}ms)`
        );
      }
    }

    // Substitution happens before assembly so every CSS consumer receives
    // substituted urls. Pruning: every full pass, incremental on request.
    const globalCss = this.substituteAssetReferences(
      result.globalCss,
      !devMode || this.staleAssetPruning === 'every-cycle'
    );

    const { declaration, variables, body } = assembleStylesheet({
      layers: this.options.layers,
      variableCss: system.variableCss,
      globalCss,
      componentCss: result.componentCss,
      split: true,
    });

    // Post-process the BODY only — the @layer declaration and variable CSS
    // pass through untouched.
    if (this.lcssTargets === null) {
      this.lcssTargets = resolveLightningTargets(
        this.options.targets,
        this.rootDir!
      );
    }
    const processedBody = postProcessCss(body, {
      minify:
        this.options.minify ??
        resolveMode(this.options.mode, () =>
          process.env.NODE_ENV === 'production' ? 'production' : 'development'
        ).mode === 'production',
      targets: this.lcssTargets,
      warnFn: (msg) => this.warn(msg),
    });

    const fullCss = [declaration, variables, processedBody]
      .filter(Boolean)
      .join('\n');

    setSharedCss(fullCss);

    const systemPropsContent = buildSystemPropsModule({
      systemPropMapJson: JSON.stringify(manifest?.system_prop_map ?? {}),
      groupRegistryJson: system.groupRegistryJson,
      dynamicProps: manifest?.dynamic_props ?? {},
    });

    setSharedSystemProps(systemPropsContent);

    setManifestJson(result.manifestJson);

    // The analyzed-hash map publishes with the manifest — one generation,
    // one publication; it is the loader's stale-input witness.
    setAnalyzedHashes(
      new Map(fileEntries.map((entry) => [entry.path, entry.hash]))
    );

    // Payloads first, then the commit, then the epoch LAST and only when its
    // value moved — an epoch-woken reader never sees an uncommitted write.
    this.writeAnalysisStatus('committing', pending);

    // The served system-props module rides in the epoch: restored modules
    // import it by absolute path, so offline content changes must move it.
    const epoch = hashReplacementPlans(
      snapshotFilePlans(manifest),
      systemPropsContent
    );
    if (this.lastCommit === null) {
      this.lastCommit = this.seedCommitFromDisk();
    }
    const generation = (this.lastCommit?.generation ?? 0) + 1;

    this.publishPayloadArtifact(
      'manifest',
      MANIFEST_ARTIFACT,
      result.manifestJson,
      epoch,
      generation,
      envelopeJsonArtifact
    );
    // Hydration artifact for isolated loader workers — the exact analyze-time
    // input set. `analyzedHashes` rides top-level so workers skip the corpus.
    if (this.persistAnalysisInputs) {
      this.publishPayloadArtifact(
        'inputs',
        ANALYSIS_INPUTS_ARTIFACT,
        JSON.stringify({
          analyzedHashes: Object.fromEntries(
            fileEntries.map((entry) => [entry.path, entry.hash])
          ),
          ...result.inputs,
        }),
        epoch,
        generation,
        envelopeJsonArtifact
      );
    }
    // Disk write serves as HMR trigger (webpack: processAssets replaces the
    // asset in-memory; Turbopack: the aliased artifact IS the stylesheet).
    this.publishPayloadArtifact(
      'styles',
      STYLES_ARTIFACT,
      fullCss,
      epoch,
      generation,
      envelopeCssArtifact
    );

    if (devMode) {
      const systemPropsHash = contentHash(systemPropsContent);
      if (systemPropsHash !== this.lastSystemPropsHash) {
        this.writeSessionArtifact(SYSTEM_PROPS_ARTIFACT, systemPropsContent);
        this.lastSystemPropsHash = systemPropsHash;
      }
    } else {
      this.writeSessionArtifact(SYSTEM_PROPS_ARTIFACT, systemPropsContent);
    }

    this.publishAnalysisCommit(epoch, generation);
    this.publishReplacementEpoch(epoch);

    bt.total = this.elapsed(pipelineStart);
    logBuildTimings(bt, manifest?.timing, (msg) => this.log(msg), this.verbose);
  }

  /** Open a status attempt (attemptId increments once per burst — a
   *  debouncing pre-write and the analysis that follows share one id). */
  private beginStatusAttempt(): void {
    if (!this.statusAttemptOpen) {
      this.statusAttemptId += 1;
      this.statusAttemptOpen = true;
    }
  }

  /** Write the session's analysis-status artifact. Terminal states
   *  (idle/failed) close the attempt. */
  private writeAnalysisStatus(
    state: AnalysisStatus['state'],
    pending: Array<[string, string]>,
    diagnostic?: string
  ): void {
    const status: AnalysisStatus = {
      schema: 2,
      sessionId: this.sessionId,
      attemptId: this.statusAttemptId,
      state,
      pending,
      deadlineAt: Date.now() + this.debounceCeilingMs + STATUS_WATCHDOG_MS,
    };
    // An ABSENT `diagnostic` differs from an empty one, which a loader would
    // surface as a blank failure message.
    if (diagnostic !== undefined) status.diagnostic = diagnostic;
    status.ready = this.firstEmissionComplete;
    this.writeSessionArtifact(ANALYSIS_STATUS_ARTIFACT, JSON.stringify(status));
    if (state === 'idle' || state === 'failed') {
      this.statusAttemptOpen = false;
    }
  }

  /** Record watch events observed during the debounce window so a loader
   *  running ahead of the analysis has evidence to wait on. */
  noteDebouncedWatchEvents(absPaths: Iterable<string>): void {
    if (!this.rootDir) return;
    const additions = this.pendingFromBatch({
      modifiedFiles: new Set(absPaths),
    });
    if (additions.length === 0) return;
    this.beginStatusAttempt();
    for (const [key, hash] of additions) this.debouncePending.set(key, hash);
    // Coalesce the disk write: a same-tick burst of observations produces
    // ONE status write carrying the full merged pending set.
    if (this.debounceStatusWriteScheduled) return;
    this.debounceStatusWriteScheduled = true;
    queueMicrotask(() => {
      this.debounceStatusWriteScheduled = false;
      // The burst may already be consumed — never clobber a later state with
      // a stale 'debouncing'.
      if (this.debouncePending.size === 0) return;
      // This microtask runs outside the caller's try/catch: an fs error must
      // not escape and kill the dev server; a missed write only delays loaders.
      try {
        this.writeAnalysisStatus('debouncing', [
          ...this.debouncePending.entries(),
        ]);
      } catch (err) {
        this.warn(`debounce status write failed: ${String(err)}`);
      }
    });
  }

  /** One pending microtask flushes a burst of debounce observations. */
  private debounceStatusWriteScheduled = false;

  /** Write one enveloped payload artifact, rewritten only when the PAYLOAD
   *  bytes changed; the recorded diskHash feeds the analysis-commit. */
  private publishPayloadArtifact(
    key: 'manifest' | 'inputs' | 'styles',
    name: string,
    payload: string,
    epoch: string,
    generation: number,
    wrap: (payload: string, envelopeJson: string) => string
  ): void {
    const payloadHash = contentHash(payload);
    if (this.artifactRecords[key] === null) {
      this.artifactRecords[key] = this.seedPayloadRecord(key, name);
    }
    const record = this.artifactRecords[key];
    if (record !== null && record.payloadHash === payloadHash) return;
    const envelope: SessionEnvelope = {
      sessionId: this.sessionId,
      generation,
      replacementEpoch: epoch,
      payloadHash,
    };
    const bytes = wrap(payload, JSON.stringify(envelope));
    this.writeSessionArtifact(name, bytes);
    this.artifactRecords[key] = { payloadHash, diskHash: contentHash(bytes) };
  }

  /** Reconstruct a payload write guard from the on-disk artifact's envelope
   *  (same-session restart: a byte-identical payload must not rewrite). */
  private seedPayloadRecord(
    key: 'manifest' | 'inputs' | 'styles',
    name: string
  ): ArtifactWriteRecord | null {
    let bytes: string;
    try {
      bytes = readFileSync(join(this.sessionDir, name), 'utf-8');
    } catch {
      return null;
    }
    let envelope: SessionEnvelope | undefined;
    try {
      envelope =
        key === 'styles' ? readCssEnvelope(bytes) : readJsonEnvelope(bytes);
    } catch {
      return null;
    }
    if (!envelope || !isDiskString(envelope.payloadHash)) return null;
    return { payloadHash: envelope.payloadHash, diskHash: contentHash(bytes) };
  }

  /** Last analysis-commit persisted in this session's directory, or null. */
  private seedCommitFromDisk(): AnalysisCommit | null {
    try {
      // SAFETY: the only writer of this artifact serializes an
      // `AnalysisCommit`; the fields any reader acts on are re-decided below.
      const parsed = JSON.parse(
        readFileSync(analysisCommitPath(this.sessionDir), 'utf-8')
      ) as AnalysisCommit;
      return parsed.schema === 1 &&
        parsed.sessionId === this.sessionId &&
        isDiskNumber(parsed.generation)
        ? parsed
        : null;
    } catch {
      return null;
    }
  }

  /** Publish the analysis-commit: written after every payload and before the
   *  epoch, skipped when the payload hashes and epoch are unchanged. */
  private publishAnalysisCommit(epoch: string, generation: number): void {
    const manifestHash = this.artifactRecords.manifest?.diskHash ?? '';
    const inputsHash = this.persistAnalysisInputs
      ? (this.artifactRecords.inputs?.diskHash ?? '')
      : undefined;
    const stylesHash = this.artifactRecords.styles?.diskHash ?? '';
    const prev = this.lastCommit;
    if (
      prev !== null &&
      prev.manifestHash === manifestHash &&
      prev.inputsHash === inputsHash &&
      prev.stylesHash === stylesHash &&
      prev.replacementEpoch === epoch
    ) {
      return;
    }
    const commit: AnalysisCommit = {
      schema: 1,
      sessionId: this.sessionId,
      generation,
      replacementEpoch: epoch,
      manifestHash,
      stylesHash,
    };
    // An ABSENT `inputsHash` marks a commit with no hydration corpus; a
    // present-but-empty hash would instead claim an empty one.
    if (inputsHash !== undefined) commit.inputsHash = inputsHash;
    this.writeSessionArtifact(ANALYSIS_COMMIT_ARTIFACT, JSON.stringify(commit));
    this.lastCommit = commit;
  }

  /** Maintain the session's epoch witness, rewritten ONLY when the value
   *  changes, then expose it through the singleton. */
  private publishReplacementEpoch(epoch: string): void {
    // Probe DISK, not just the memo: a sibling's reconciliation can delete
    // this artifact, and an absent witness always satisfies webpack's check.
    const onDisk = this.diskEpochValue();
    if (this.lastEpochValue === null) {
      this.lastEpochValue = onDisk;
    }
    if (epoch !== onDisk) {
      this.writeSessionArtifact(
        REPLACEMENT_EPOCH_ARTIFACT,
        JSON.stringify({ schema: 1, sessionId: this.sessionId, epoch })
      );
    }
    if (epoch !== this.lastEpochValue) {
      this.lastEpochValue = epoch;
      this.reconcileSiblingEpochs(epoch);
    }
    setReplacementEpoch(epoch);
  }

  /** sessions-root listing memo, keyed by the root dir's mtime — a new or
   *  pruned sibling DIRECTORY moves it; agreeing siblings stay listed. */
  private siblingListing: { mtimeMs: number; entries: string[] } | null = null;

  private reconcileSiblingEpochs(epoch: string): void {
    const rootPath = sessionsRootDir(this.rootDir!);
    let entries: string[];
    try {
      const mtimeMs = statSync(rootPath).mtimeMs;
      if (this.siblingListing?.mtimeMs === mtimeMs) {
        entries = this.siblingListing.entries;
      } else {
        entries = readdirSync(rootPath);
        this.siblingListing = { mtimeMs, entries };
      }
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry === this.sessionId) continue;
      // No "already reconciled" memo: a sibling rewrites its artifact
      // whenever its own publish finds it missing, so only its bytes answer.
      const siblingDir = join(rootPath, entry);
      const siblingEpochPath = join(siblingDir, REPLACEMENT_EPOCH_ARTIFACT);
      try {
        // SAFETY: siblings write this artifact through the same publish path;
        // a missing epoch counts as disagreement, the fail-safe direction.
        const parsed = JSON.parse(readFileSync(siblingEpochPath, 'utf-8')) as {
          epoch?: string;
        };
        // Agreeing siblings stay byte-untouched AND stay candidates — a
        // later epoch value can turn them stale.
        if (parsed.epoch === epoch) continue;
      } catch (err) {
        // SAFETY: `err` is the throw of `readFileSync`/`JSON.parse`; `?.code`
        // reads through whatever it is and only `ENOENT` is acted on.
        if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') continue;
        // Unreadable/corrupt sibling artifact: fall through to deletion —
        // fail-safe invalidation beats a stale-but-valid snapshot.
      }
      const ownerPid = this.liveSiblingOwnerPid(siblingDir);
      if (ownerPid !== null) {
        this.warn(
          `sibling session ${entry} still has a live owner (pid ${ownerPid}) ` +
            `and its replacement epoch disagrees with this session's ` +
            `(${epoch}) — leaving its epoch artifact in place`
        );
        continue;
      }
      try {
        unlinkSync(siblingEpochPath);
      } catch {
        // Concurrent prune/removal — the invalidation already happened.
      }
    }
  }

  /** The pid of `siblingDir`'s live owner, or null when nothing proves one.
   *  Our own pid is never one — publication is process-exclusive. */
  private liveSiblingOwnerPid(siblingDir: string): number | null {
    let claim: ReturnType<typeof readCliLockRecord>;
    try {
      claim = readCliLockRecord(siblingDir);
    } catch {
      // An unreadable claim (EACCES, a raced-away tree) is not a live one.
      return null;
    }
    if (claim.kind !== 'held') return null;
    if (claim.record.pid === process.pid) return null;
    return checkLockLiveness(claim.record).live ? claim.record.pid : null;
  }

  /** Epoch value held by this session's on-disk artifact, or null when
   *  absent, unreadable, or not the expected schema. */
  private diskEpochValue(): string | null {
    try {
      // SAFETY: this artifact's only writer serializes
      // `{ schema: 1, sessionId, epoch }`; both fields are re-decided below.
      const parsed = JSON.parse(
        readFileSync(replacementEpochPath(this.sessionDir), 'utf-8')
      ) as { schema?: number; epoch?: string };
      return parsed.schema === 1 && isDiskString(parsed.epoch)
        ? parsed.epoch
        : null;
    } catch {
      return null;
    }
  }

  /** True when the flat `.animus/` advisory lock claims the tree. A lock that
   *  exists but cannot be decoded claims it too — unknown is never absent. */
  private cliWriterHoldsLock(animusDir: string): boolean {
    // Shape and liveness are the writer-side contract — this gate must not
    // hand-roll a second reading of the artifact it shares.
    const lock = readCliLockRecord(animusDir);
    if (lock.kind === 'none') return false;
    return lock.kind === 'indeterminate' || checkLockLiveness(lock.record).live;
  }

  /** Delete legacy flat artifacts and prune sibling session directories past
   *  the retention window — never this session's own dir. */
  private runSessionStartHygiene(): void {
    if (this.sessionStartHygieneDone) return;
    this.sessionStartHygieneDone = true;
    const animusDir = join(this.rootDir!, ANIMUS_ARTIFACT_DIR);
    // A flat set whose commit record VERIFIES is the CLI's published output,
    // and a live CLI lock protects the tree; anything else is debris.
    const isCliPublishedSet =
      this.cliWriterHoldsLock(animusDir) ||
      verifyCommitRecord(animusDir).length === 0;
    // The skip covers ONLY the names the CLI publishes; legacy session
    // artifacts are never CLI output and stay cleaned regardless.
    const cliPublishedNames: readonly string[] = [
      MANIFEST_ARTIFACT,
      STYLES_ARTIFACT,
      SYSTEM_PROPS_ARTIFACT,
    ];
    for (const name of LEGACY_FLAT_ARTIFACTS) {
      if (isCliPublishedSet && cliPublishedNames.includes(name)) continue;
      try {
        unlinkSync(join(animusDir, name));
      } catch {
        // absent — nothing to clean
      }
    }
    if (!isCliPublishedSet) {
      try {
        unlinkSync(join(animusDir, CLI_COMMIT_ARTIFACT));
      } catch {
        // absent — nothing to clean
      }
    }
    let entries: string[];
    try {
      entries = readdirSync(sessionsRootDir(this.rootDir!));
    } catch {
      return;
    }
    const cutoff = Date.now() - SESSION_DIR_MAX_AGE_MS;
    for (const entry of entries) {
      if (entry === this.sessionId) continue;
      const dir = join(sessionsRootDir(this.rootDir!), entry);
      try {
        if (statSync(dir).mtimeMs >= cutoff) continue;
        // Age is evidence of abandonment, not proof: a quiet dev server has
        // an old directory and a live owner. The claim record is the proof.
        if (this.liveSiblingOwnerPid(dir) !== null) continue;
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // raced away — another live session may be pruning too
      }
    }
  }

  /** Write one artifact write-then-rename, so a cross-process reader never
   *  sees a torn file; the tmp name carries the pid to keep writers apart. */
  private writeSessionArtifact(name: string, content: string): void {
    const dir = this.sessionDir;
    // Unconditional: mkdirSync(recursive) is a no-op when the dir exists.
    mkdirSync(dir, { recursive: true });
    const tmpPath = join(dir, `.${name}.${process.pid}.tmp`);
    writeFileSync(tmpPath, content);
    renameSync(tmpPath, join(dir, name));
    this.onArtifactWrite?.(name, content);
  }

  /** Copy each asset() specifier's bytes into `assets/` under a
   *  content-hashed name and substitute a url relative to styles.css. */
  private substituteAssetReferences(
    globalCss: string,
    pruneSuperseded: boolean
  ): string {
    const specifiers = findAssetSpecifiers(globalCss);
    const assetsDir = join(this.sessionDir, SESSION_ASSETS_DIR);
    const expected = new Set<string>();
    this.assetDependencyPaths.clear();
    this.assetDependencyKeys.clear();

    const urlBySpecifier = new Map<string, string>();
    for (const specifier of specifiers) {
      // The memo reduces a steady-state pass to one existsSync; a missing
      // copy (concurrent prune) falls through and self-heals.
      const cached = this.assetCopyCache.get(specifier);
      if (cached && existsSync(join(assetsDir, cached.fileName))) {
        try {
          const current = statSync(cached.sourcePath);
          if (
            current.mtimeMs === cached.mtimeMs &&
            current.size === cached.size
          ) {
            this.trackAssetDependency(cached.sourcePath);
            expected.add(cached.fileName);
            urlBySpecifier.set(specifier, cached.url);
            continue;
          }
        } catch {
          // Re-resolve below; strict/non-strict policy remains centralized.
        }
      }
      const resolvedPath = this.resolveAssetSpecifier(specifier);
      if (!resolvedPath) {
        const message = `unresolvable asset() specifier: ${specifier}`;
        if (this.options.strict)
          throw new Error(`[${this.driverLabel}] ${message}`);
        this.warn(message);
        urlBySpecifier.set(specifier, specifier);
        continue;
      }
      const bytes = readFileSync(resolvedPath);
      const sourceStat = statSync(resolvedPath);
      this.trackAssetDependency(resolvedPath);
      const ext = extname(resolvedPath);
      const stem = basename(resolvedPath, ext);
      const fileName = `${stem}.${contentHash(bytes).slice(0, 8)}${ext}`;
      expected.add(fileName);
      if (!existsSync(assetsDir)) {
        mkdirSync(assetsDir, { recursive: true });
      }
      const assetPath = join(assetsDir, fileName);
      if (!existsSync(assetPath)) {
        writeFileSync(assetPath, bytes);
      }
      const url = `./${SESSION_ASSETS_DIR}/${fileName}`;
      urlBySpecifier.set(specifier, url);
      this.assetCopyCache.set(specifier, {
        sourcePath: resolvedPath,
        mtimeMs: sourceStat.mtimeMs,
        size: sourceStat.size,
        fileName,
        url,
      });
    }

    // Runs AFTER the writes so the current set is always on disk: copies are
    // content-hashed and never overwritten, so superseded ones accumulate.
    if (pruneSuperseded) pruneStaleAssets(assetsDir, expected);

    return substituteAssetPlaceholders(globalCss, urlBySpecifier);
  }

  private trackAssetDependency(path: string): void {
    this.assetDependencyPaths.add(path);
    for (const key of toWatchKeys(path)) this.assetDependencyKeys.add(key);
  }

  /** Resolve an asset specifier through the shared resolver, with one
   *  last resort: a discovered source entry's package root. */
  private resolveAssetSpecifier(specifier: string): string | null {
    const resolved = resolveAssetFile(
      specifier,
      this.rootDir!,
      this.pathAliasesJson
    );
    if (resolved) return resolved;

    const segments = specifier.split('/');
    const packageName = specifier.startsWith('@')
      ? segments.slice(0, 2).join('/')
      : segments[0];
    const subpath = specifier.slice(packageName.length + 1);
    if (!subpath) return null;
    const sourceEntry =
      this.externalSourceEntries.get(packageName) ??
      [...this.externalSourceEntries].find(
        ([declared]) =>
          declared === packageName || declared.startsWith(`${packageName}/`)
      )?.[1];
    if (sourceEntry) {
      const candidate = join(findPackageRoot(sourceEntry), subpath);
      if (existsSync(candidate)) return candidate;
    }
    return null;
  }
}

/** Sync `assets/` to the current build's file set; per-entry failures are
 *  tolerated — a concurrent session may have removed the same file. */
export function pruneStaleAssets(
  assetsDir: string,
  expected: ReadonlySet<string>
): void {
  if (!existsSync(assetsDir)) return;
  let entries: string[];
  try {
    entries = readdirSync(assetsDir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (expected.has(entry)) continue;
    try {
      unlinkSync(join(assetsDir, entry));
    } catch {
      // Concurrent session removal, or an unexpected subdirectory — leave it.
    }
  }
}
