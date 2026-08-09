import {
  assembleStylesheet,
  assertNoErrorDiagnostics,
  buildSystemPropsModule,
  clearEngineCache,
  collectExternalPackageSources,
  contentHash,
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
  mergeExternalKeyframes,
  postProcessCss,
  preprocessMdx,
  resolveAssetFile,
  resolveLightningTargets,
  runProjectAnalysis,
  serializeStaticCss,
  sharesVolumeRoot,
  snapshotFilePlans,
  staleDistIncludesMessage,
  substituteAssetPlaceholders,
  toWatchKeys,
  unresolvableIncludesMessage,
  walkPackageSources,
} from '@animus-ui/extract/pipeline';
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

import { resolvePackagesByName } from './resolve-packages';
import {
  ANALYSIS_COMMIT_ARTIFACT,
  ANALYSIS_INPUTS_ARTIFACT,
  ANALYSIS_STATUS_ARTIFACT,
  analysisCommitPath,
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
  claimProcessSessionId,
  engineApi,
  getWatchTransaction,
  resetAnalysisPromise,
  setAnalysisPromise,
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
  AnalysisCommit,
  AnalysisStatus,
  SessionEnvelope,
} from './session-paths';
import type { AnimusNextOptions } from './types';
import type {
  DynamicPropMeta,
  LightningTargets,
  ManifestDiagnostic,
  SourceIdentity,
  SystemConfig,
} from '@animus-ui/extract/pipeline';

/**
 * Module id the Rust emitter injects for the extracted stylesheet — also the
 * exact resolve.alias key with-animus registers for it, which the adapter's
 * alias harvesting must skip.
 */
export const ANIMUS_CSS_MODULE_ID = '.animus/styles.css';

/** Retention window for sibling session directories (design D2). */
const SESSION_DIR_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Watchdog added to the debounce ceiling for status deadlines (D3). */
const STATUS_WATCHDOG_MS = 2000;

/** Flat legacy `.animus/` artifacts removed at session start — unreachable
 *  by session-scoped loaders and no longer written by anyone. */
const LEGACY_FLAT_ARTIFACTS = [
  MANIFEST_ARTIFACT,
  ANALYSIS_INPUTS_ARTIFACT,
  STYLES_ARTIFACT,
  SYSTEM_PROPS_ARTIFACT,
  REPLACEMENT_EPOCH_ARTIFACT,
  ANALYSIS_COMMIT_ARTIFACT,
  ANALYSIS_STATUS_ARTIFACT,
] as const;

/** Default path fragments excluded from source discovery (full + watch). */
const DEFAULT_EXCLUDE = [
  'node_modules',
  'dist',
  '.test.',
  '.spec.',
  '.next',
  '.animus',
];

type FileEntry = { path: string; source: string; hash: string };

/** Watch-cycle change sets, as reported by the bundler's watcher. */
export interface WatchChanges {
  modifiedFiles?: ReadonlySet<string>;
  removedFiles?: ReadonlySet<string>;
}

/**
 * Bundler-agnostic extraction pipeline: system loading, source discovery
 * and ingestion, external-package collection, analysis, stylesheet and
 * system-props emission, and watch-cycle diffing.
 *
 * The webpack adapter (plugin.ts) owns only bundler wiring: hook
 * registration, alias harvesting from the compiler config, in-memory asset
 * replacement, and translating watch events into `handleWatchUpdate`
 * change sets. Keeping this class free of webpack types is deliberate — a
 * future Turbopack integration must drive the same session from outside
 * the bundler (Turbopack has no compiler-hook surface), reusing everything
 * here unchanged.
 *
 * Outputs are published through the package singleton (shared CSS,
 * manifest, system props) and written to `.animus/` on disk.
 */
export class ExtractionSession {
  /** Set by the adapter before any pipeline run. */
  rootDir: string | null = null;
  /** Serialized path aliases, harvested by the adapter from bundler config. */
  pathAliasesJson: string | null = null;

  // Per-specifier resolve/copy memo for substituteAssetReferences — the
  // result is stable per loaded system, so it is cleared on system load.
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
  /** Emitter identity override for the system-props module id. Webpack mode
   *  (null) injects the absolute `.animus/system-props.js` path, resolved by
   *  NormalModuleReplacement; Turbopack rejects absolute-path imports, so
   *  its driver sets the virtual id that `resolveAlias` maps to disk. */
  systemPropsModuleId: string | null = null;
  /** Whether the analysis-inputs hydration corpus is serialized + written.
   *  False (webpack mode): the loader shares the pipeline process and reads
   *  the manifest from memory — the corpus is never persisted. True is set
   *  by the Turbopack orchestration driver, whose isolated loader workers
   *  replay it (spec: next-turbopack-integration, "Manifest disk artifact" /
   *  "Webpack mode skips the hydration corpus"). */
  persistAnalysisInputs = false;

  /** Absolute directory prefixes for external DS packages (loader allowlisting). */
  externalPackageDirs: string[] = [];
  /** Absolute package dir → owning specifier (cross-source correlation). */
  private externalDirOwners: Record<string, string> = {};
  /** rootDir-relative external file → owning specifier (correlation join). */
  private externalFileOwners: Record<string, string> = {};
  /** External package specifier → absolute source entry path. */
  externalSourceEntries = new Map<string, string>();
  /** SourceId derivation authority for the current generation (openspec:
   *  external-source-watch-ingestion, design D2) — canonical roots
   *  realpath'd once per full pipeline; alias→SourceId associations
   *  recorded while files exist so deletion resolves through the cache. */
  private sourceIdentity: SourceIdentity | null = null;
  /** Canonical admitted external root → declared specifiers (set-valued
   *  ownership, design D2; duplicate specifiers resolving to one canonical
   *  root share it). Engine watch wiring and tests read this. */
  externalRootOwners = new Map<string, Set<string>>();
  /** Canonical external root → the extension set its collection walk used
   *  (widened for dist-only roots); rewalks and classification share it. */
  private externalRootExtensions = new Map<string, ReadonlySet<string>>();
  /** Canonical admitted external watch roots — the engine-side watch
   *  surface (webpack contextDependencies / Turbopack watchers). */
  externalWatchRoots: string[] = [];
  /** Canonical external root → (raw sourceKey → {raw content hash, recorded
   *  abs spelling}): the previous-generation inventory a dirty-root rewalk
   *  diffs against (design D3). Raw hashes — MDX preprocessing never skews
   *  the diff; the recorded abs path is a registered deletion alias, so a
   *  reconstructed deletion always resolves through cached identity. */
  private externalInventory = new Map<
    string,
    Map<string, { hash: string; abs: string }>
  >();
  /** Sticky diagnostics (design D5/D7): stable key → message, re-surfaced
   *  on every full pipeline until the underlying condition clears. */
  readonly stickyDiagnostics = new Map<string, string>();
  /** Volume-membership predicate for the cross-volume gate (design D5).
   *  Injected seam: the shared predicate only discriminates on Windows
   *  (win32 semantics are unit-tested via path.win32), so runtime tests
   *  drive the gate through this. */
  sharesProjectVolume: (projectRoot: string, externalRoot: string) => boolean =
    sharesVolumeRoot;
  /** Orchestrator seams (openspec: external-source-watch-ingestion, design
   *  D4). `onExternalRootResolved` fires per volume-admitted external root
   *  DURING collection — after resolution, BEFORE that root's sources are
   *  walked — so a watching host can open its handle with no blind gap
   *  between scan and watch. `onExternalRootsCommitted` fires once after a
   *  successful full-pipeline publication with the complete admitted
   *  canonical root set (the host's promote/replay/close-old phase; a
   *  failed pipeline never fires it, so the host rolls back). */
  onExternalRootResolved: ((canonicalRoot: string) => void) | null = null;
  onExternalRootsCommitted: ((canonicalRoots: string[]) => void) | null = null;

  private readonly options: AnimusNextOptions;
  private readonly staticCssJson: string | null;
  private system: SystemConfig | null = null;
  /** Discovery-time keyframes diagnostics awaiting the shared surfacing pass. */
  private externalKeyframesDiagnostics: ManifestDiagnostic[] = [];
  /** Full package-resolution map from the last full pipeline — replayed by
   *  incremental passes (sourceEntries alone omits dist-resolved packages). */
  private lastPackageMap: Record<string, string> = {};

  // File tracking for HMR
  private fileCache = new Map<string, { hash: string; source: string }>();

  // Membership keys (lexical + canonical) for the system's evaluated
  // module-file set — the geological-reset classification set. Refreshed on
  // every successful system load; a failed reload keeps the last
  // successful set, matching the stale config still being served.
  private systemDependencyKeys: Set<string> = new Set();

  /** Loader-reported dependency paths for bundler watch registration. */
  systemDependencyPaths: string[] = [];

  // Content hashes of the dependency files at load time — the fallback
  // probe for watch passes that carry no modified/removed sets (webpack's
  // first watchRun; harnesses without watch-event translation).
  private systemDependencyHashes: Map<string, string> = new Map();
  private lastSystemPropsHash: string | null = null;
  /** Per-payload write guards: payloadHash gates rewrites (byte-identical
   *  payloads leave disk untouched); diskHash is the hash of the CURRENT
   *  disk bytes (envelope included) recorded in the analysis-commit. null =
   *  not yet seeded (first publication reads the artifact's envelope so a
   *  same-session restart never rewrites byte-identical artifacts). */
  private artifactRecords: {
    manifest: { payloadHash: string; diskHash: string } | null;
    inputs: { payloadHash: string; diskHash: string } | null;
    styles: { payloadHash: string; diskHash: string } | null;
  } = { manifest: null, inputs: null, styles: null };
  /** Last written analysis-commit; null = seeded from disk on first use. */
  private lastCommit: AnalysisCommit | null = null;
  /** Session identity — claimed once per PROCESS (one Next invocation),
   *  adopted by every subsequent session instance so all compilers share
   *  one artifact tree (design D2: `next dev`/`next build` co-writing are
   *  separate processes and therefore separate sessions). */
  readonly sessionId: string = claimProcessSessionId();
  /** Epoch value of the last published analysis; null = not yet known
   *  (seeded from the session dir's artifact on first publication so a
   *  same-session restart with unchanged plans never rewrites bytes). */
  private lastEpochValue: string | null = null;
  /** Watcher debounce ceiling feeding status deadlines (design D3). */
  debounceCeilingMs = 75;
  /** Test seam: observes every session-artifact write (name, content)
   *  post-rename — write ORDER is part of the transaction contract. */
  onArtifactWrite: ((name: string, content: string) => void) | null = null;
  /** Status attempt bookkeeping (design D3). */
  private statusAttemptId = 0;
  private statusAttemptOpen = false;
  /** Debounce-window observations pending analysis (sourceKey → hash). */
  private debouncePending = new Map<string, string>();
  /** Session-start hygiene (pruning + legacy cleanup) runs once. */
  private sessionStartHygieneDone = false;
  // Lightning CSS targets — resolved lazily once per session (browserslist
  // config I/O), spec: css-post-processing.
  private lcssTargets: LightningTargets | null = null;

  constructor(options: AnimusNextOptions) {
    this.options = options;
    // Serialized once (stable key order) so the analysis-inputs hash is
    // insensitive to option-object identity.
    this.staticCssJson = serializeStaticCss(options.staticCss);
  }

  /** This session's artifact directory. Requires `rootDir` to be set. */
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
      console.info(`[animus] ${msg}`);
    }
  }

  private warn(msg: string): void {
    console.warn(`[animus] ${msg}`);
  }

  // Zero-cost timer gate
  private now(): number {
    return this.verbose ? performance.now() : 0;
  }
  private elapsed(t: number): number {
    return this.verbose ? Math.round(performance.now() - t) : 0;
  }

  /** Lazily-computed scan config (options are constructor-fixed, so the
   *  derivation is stable for the session's lifetime). */
  private scanConfigMemo: {
    excludePatterns: string[];
    extensionsSet: ReadonlySet<string>;
    shouldHandleMdx: boolean;
  } | null = null;

  /** Resolve the scan configuration from options — the single source of the
   *  exclude/extension policy shared by the full and incremental pipelines. */
  private resolveScanConfig(): {
    excludePatterns: string[];
    extensionsSet: ReadonlySet<string>;
    shouldHandleMdx: boolean;
  } {
    if (this.scanConfigMemo === null) {
      const extensionsSet: ReadonlySet<string> = new Set(
        this.options.extensions ?? DEFAULT_EXTENSIONS
      );
      this.scanConfigMemo = {
        excludePatterns: this.options.exclude ?? DEFAULT_EXCLUDE,
        extensionsSet,
        shouldHandleMdx: extensionsSet.has('.mdx'),
      };
    }
    return this.scanConfigMemo;
  }

  /**
   * Watch entry point: one single-flight analysis transaction per event
   * batch (openspec: next-webpack-served-transform-coherence, design D3).
   * The first entering session runs the transaction; every concurrent
   * entry — same session re-entered, or another compiler's session
   * (client/server/RSC each hold their own instance) — joins the in-flight
   * promise, so no compiler proceeds against a generation older than the
   * one the transaction publishes. A rejected transaction rejects every
   * joiner; the gate always clears.
   */
  async handleWatchUpdate(changes: WatchChanges): Promise<void> {
    const inflight = getWatchTransaction();
    if (inflight) {
      await inflight;
      return;
    }

    // Guard: if system state was never loaded (non-owning instance that
    // skipped runFullPipeline), skip — processAssets reads from shared
    // variable. Checked AFTER the join so a non-owning session still awaits
    // an in-flight transaction instead of proceeding stale.
    if (!this.system) return;

    const transaction = this.processWatchUpdate(changes);
    setWatchTransaction(transaction);
    try {
      await transaction;
    } finally {
      setWatchTransaction(null);
    }
  }

  /**
   * Incremental watch pass: geological reset when the system file changed,
   * otherwise content-hash diffing restricted to the watcher's change sets
   * (falling back to a full discovery walk when no sets are provided).
   */
  private async processWatchUpdate(changes: WatchChanges): Promise<void> {
    const rootDir = this.rootDir!;

    // Root-dirty inventory reconciliation FIRST (design D3): dirty external
    // roots are rewalked and their created/edited/deleted deltas
    // reconstructed BEFORE any event classification — a bare directory
    // report cannot be classified (the hidden child could be a system
    // dependency), so classification below always runs over concrete file
    // paths. Reconciliation failures degrade to the raw change sets.
    try {
      changes = this.reconcileExternalRoots(changes);
    } catch (err) {
      this.warn(`external root reconciliation failed: ${String(err)}`);
    }

    // The post-reconciliation batch, flattened once — shared by the
    // system-dependency find and the asset-dependency check below.
    const changed = [
      ...(changes.modifiedFiles ?? []),
      ...(changes.removedFiles ?? []),
    ];

    // Geological reset: any changed or removed file in the system's
    // evaluated module-file set (loader-reported dependencies plus the
    // entry). Membership is keyed lexically and canonically, so events via
    // symlinked or already-deleted paths still classify. One reset per
    // watch batch — the bundler already coalesces events per rebuild.
    let assetChanged = false;
    try {
      let systemHit: string | undefined;
      if (!changes.modifiedFiles && !changes.removedFiles) {
        // No change sets (first watchRun; harnesses without watch-event
        // translation): probe the dependency files by content hash.
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
      if (systemHit) {
        this.log(
          `geological reset: system dependency changed (${relative(rootDir, systemHit)})`
        );
        this.resetForHmr();
        const promise = this.runFullPipeline(this.pendingFromBatch(changes));
        setAnalysisPromise(promise);
        await promise;
        return;
      }

      if (
        changed.some((path) =>
          toWatchKeys(path).some((key) => this.assetDependencyKeys.has(key))
        )
      ) {
        // A changed asset invalidates the copy memo and forces re-analysis,
        // but the batch may ALSO carry component edits and removals (branch
        // switch, editor save-all, git checkout): fall through to the shared
        // read/re-hash/prune flow instead of replaying the cache — an entry
        // analyzed stale here would never re-surface, since its cache hash
        // was never updated.
        this.assetCopyCache.clear();
        assetChanged = true;
      }
    } catch (err) {
      // Not a benign probe: this wraps the geological-reset re-run.
      // Swallowing keeps a transient failure from crashing the watch loop,
      // but a real fault must stay diagnosable.
      this.warn(`HMR geological-reset check failed: ${String(err)}`);
    }

    // Check for component file changes using content-hash diffing
    const { excludePatterns, extensionsSet, shouldHandleMdx } =
      this.resolveScanConfig();

    // Prior cache entries for every path this batch touches — restored on
    // analysis failure so the SAME content re-runs analysis on the next
    // observation (spec: dev-served-transform-coherence, "Failed analyses
    // publish no partial generation" — a poisoned hash cache would silently
    // suppress the equal-content retry). null = the path had no entry.
    const priorCacheEntries = new Map<
      string,
      { hash: string; source: string } | null
    >();
    const recordPrior = (key: string) => {
      if (!priorCacheEntries.has(key)) {
        priorCacheEntries.set(key, this.fileCache.get(key) ?? null);
      }
    };

    // External-inventory mutations of this batch, applied only after the
    // analysis publishes (mirror of the fileCache rollback below: a failed
    // attempt must leave the previous generation's inventory in place so
    // the same delta reconciles again).
    const inventoryUpdates: Array<{
      root: string;
      key: string;
      hash: string | null;
      abs: string;
    }> = [];
    // Owner records for deleted files, deferred for the same reason: the
    // `fileCache` rollback below restores a failed attempt's entries, so a
    // file that comes back must still have an owner. Deleting eagerly left a
    // restored cache entry with no owner, and
    // `correlateExternalTokenDiagnostics` silently skips any diagnostic whose
    // file has none — dropping that file's token-contract errors for the rest
    // of the session, since owners are otherwise rebuilt only by a full
    // pipeline run.
    const ownerRemovals: string[] = [];

    // Prune deleted/renamed files so their last-known source stops riding
    // along as a ghost entry on every subsequent incremental analysis.
    // Out-of-root deletions resolve through cached identity only — never
    // fresh canonicalization of a gone path (design D2).
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
        recordPrior(key + '.tsx');
        // MDX cache keys carry the preprocessed `.tsx` suffix.
        if (this.fileCache.delete(key) || this.fileCache.delete(key + '.tsx')) {
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

    // Restrict the read+hash pass to the watcher's modified set when
    // available; fall back to a full discovery walk otherwise. Membership
    // routes through `classifyWatchPath` — project-root members keep the
    // consumer filters, external members resolve through the identity
    // authority (spec: next-dev-hmr, "External workspace events reach the
    // incremental pass").
    let targets: Array<{ abs: string; key: string; owningRoot: string | null }>;
    if (changes.modifiedFiles) {
      targets = [];
      for (const modifiedPath of changes.modifiedFiles) {
        const classified = this.classifyWatchPath(modifiedPath, {
          excludePatterns,
          extensionsSet,
        });
        if (classified) targets.push({ abs: modifiedPath, ...classified });
      }
    } else {
      targets = discoverFiles(
        rootDir,
        rootDir,
        excludePatterns,
        extensionsSet
      ).map((abs) => ({ abs, key: relative(rootDir, abs), owningRoot: null }));
    }

    const changedPaths: string[] = [];

    for (const target of targets) {
      let relPath = target.key;
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

      if (shouldHandleMdx && extname(target.abs) === '.mdx') {
        // Watch pass stays silent on failure — the full pipeline already
        // surfaced any missing-dep / preprocessing warning.
        const processed = await this.preprocessMdxEntry(source, relPath, {
          warn: false,
        });
        if (!processed) continue;
        source = processed.source;
        relPath = processed.relPath;
      }

      const cached = this.fileCache.get(relPath);
      const hash = relPath === target.key ? rawHash : contentHash(source);

      if (!cached || cached.hash !== hash) {
        changedPaths.push(relPath);
        recordPrior(relPath);
        this.fileCache.set(relPath, { hash, source });
        if (target.owningRoot) {
          // Ownership records before the analysis runs (the in-flight
          // analysis correlates diagnostics against it); most-specific
          // root, first-declared specifier (design D2).
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
      // Every cached file rides with full source (v2 has no Rust-side cache).
      const fileEntries = this.buildFileEntriesFromCache();

      // The observed batch — exactly the (sourceKey, sourceHash) pairs this
      // attempt is analyzing — feeds the status file's pending set (D3).
      const pending: Array<[string, string]> = changedPaths.map((rel) => [
        rel,
        this.fileCache.get(rel)!.hash,
      ]);

      resetAnalysisPromise();
      const promise = this.runIncrementalPipeline(fileEntries, pending);
      setAnalysisPromise(promise);
      try {
        await promise;
      } catch (err) {
        // Roll the cache back to the pre-batch state: the failed attempt
        // published nothing, so the next observation of the same content
        // must analyze again instead of silently matching the cache.
        for (const [key, prior] of priorCacheEntries) {
          if (prior === null) this.fileCache.delete(key);
          else this.fileCache.set(key, prior);
        }
        throw err;
      }
      // The batch published: fold its external deltas into the
      // previous-generation inventory (a failed attempt above skipped
      // this, so the same delta reconciles again on retry).
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
      // A debounced burst produced nothing analyzable — close the attempt
      // so no loader waits on a status that will never commit (design D3).
      this.debouncePending.clear();
      this.writeAnalysisStatus('idle', []);
    }
  }

  /**
   * Preprocess one `.mdx` entry into scanner-consumable tsx. Returns the
   * rewritten source plus the `relPath + '.tsx'` path on success, or null
   * when the file must be skipped.
   *
   * `warn: false` (incremental watch pass) skips silently — the full
   * pipeline already surfaced the warning. `warn: true` (full pipeline)
   * warns ONCE for a missing @mdx-js/mdx dependency via the shared
   * `missingDepFlag` holder, and every time for a preprocessing error.
   */
  private async preprocessMdxEntry(
    source: string,
    relPath: string,
    opts: { warn: boolean; missingDepFlag?: { warned: boolean } }
  ): Promise<{ source: string; relPath: string } | null> {
    const result = await preprocessMdx(source, relPath);
    if (result.kind === 'missing-dep') {
      if (opts.warn && opts.missingDepFlag && !opts.missingDepFlag.warned) {
        console.warn(
          '[animus] ⚠ .mdx in extensions but @mdx-js/mdx not installed; MDX files skipped'
        );
        opts.missingDepFlag.warned = true;
      }
      return null;
    }
    if (result.kind === 'error') {
      if (opts.warn) {
        console.warn(
          `[animus] ⚠ MDX preprocessing failed for ${relPath}: ${result.error}`
        );
      }
      return null;
    }
    // Path rewrite so the Rust source-type helper parses as tsx.
    return { source: result.source!, relPath: relPath + '.tsx' };
  }

  async runFullPipeline(pending: Array<[string, string]> = []): Promise<void> {
    const pipelineStart = this.now();
    const bt: Record<string, number> = {};

    // Session-start hygiene (design D2): drop legacy flat artifacts (new
    // loaders cannot reach them) and prune sibling session dirs beyond the
    // retention window. Publish this session's artifact dir for the
    // in-process webpack loader before any analysis can complete.
    this.runSessionStartHygiene();
    setSessionArtifactDir(this.sessionDir);

    // Clear Rust-side per-file cache so stale results from a prior
    // build never bleed into a fresh pipeline run.
    clearEngineCache(engineApi);

    const rootDir = this.rootDir!;
    const resolvedSystemPath = resolve(rootDir, this.options.system);

    // Step 1: Load system via NAPI
    let t = this.now();
    this.system = loadSystemConfig(engineApi, {
      systemPath: resolvedSystemPath,
      rootDir,
      prefix: this.options.prefix,
    });
    // Asset specifiers resolve against the system just loaded — drop the
    // per-specifier copy memo so a changed reference re-reads and re-hashes.
    this.assetCopyCache.clear();
    this.assetDependencyPaths.clear();
    this.assetDependencyKeys.clear();
    {
      // Refresh the geological-reset membership set: every loader-evaluated
      // module plus (defensively) the entry, keyed lexically and
      // canonically so symlinked/deleted event paths still match.
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

    // Step 2: Discover source files
    t = this.now();
    const { excludePatterns, extensionsSet, shouldHandleMdx } =
      this.resolveScanConfig();
    const missingDepFlag = { warned: false };
    const files = discoverFiles(
      rootDir,
      rootDir,
      excludePatterns,
      extensionsSet
    );

    bt.fileDiscovery = this.elapsed(t);

    // Step 3: Read file sources and build entries (preprocessing MDX as we go)
    t = this.now();
    const fileEntries: FileEntry[] = [];
    for (const filePath of files) {
      let source = readFileSync(filePath, 'utf-8');
      let relPath = relative(rootDir, filePath);

      if (shouldHandleMdx && extname(filePath) === '.mdx') {
        const processed = await this.preprocessMdxEntry(source, relPath, {
          warn: true,
          missingDepFlag,
        });
        if (!processed) continue;
        source = processed.source;
        relPath = processed.relPath;
      }

      const hash = contentHash(source);
      this.fileCache.set(relPath, { hash, source });
      fileEntries.push({ path: relPath, source, hash });
    }

    bt.fileRead = this.elapsed(t);
    bt.fileCount = fileEntries.length;

    // Step 4: Resolve external packages from system file imports. Workspace
    // walk + require.resolve stays local (the Node-resolution seam); the
    // traversal/ingest below is the shared collector
    // (spec: external-package-file-discovery).
    t = this.now();
    const packageNames = extractSystemFilePackages(resolvedSystemPath);
    const preResolved = resolvePackagesByName(rootDir, packageNames);

    // Raw content hashes of every external file the collection walked,
    // keyed by absolute path — recorded BEFORE MDX preprocessing so the
    // dirty-root inventory diff compares raw bytes (design D3), and
    // resolved through the identity handle below only for packages that
    // survive the cross-volume gate.
    const rawExternalFiles = new Map<string, string>();

    const collected = await collectExternalPackageSources({
      specifiers: packageNames,
      resolveSpecifier: (name) =>
        preResolved[name] ? resolve(rootDir, preResolved[name]) : null,
      rootDir,
      extensionsSet,
      hasEntry: (relPath) => fileEntries.some((e) => e.path === relPath),
      preprocessFile: async (source, relPath, absPath) => {
        rawExternalFiles.set(absPath, contentHash(source));
        if (shouldHandleMdx && extname(absPath) === '.mdx') {
          return this.preprocessMdxEntry(source, relPath, {
            warn: true,
            missingDepFlag,
          });
        }
        return { source, relPath };
      },
      onUnreadable: (relPath, err) =>
        this.warn(`skipped unreadable package file ${relPath}: ${String(err)}`),
      onPackageResolved: (_specifier, packageDir) => {
        if (!this.onExternalRootResolved) return;
        // The cross-volume gate runs after collection; a rejected root
        // must never be watched, so the volume predicate also gates the
        // open-new phase (design D5: atomic exclusion — no watcher).
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

    for (const record of collected.outcomes) {
      if (record.outcome === 'empty') {
        this.warn(
          `include '${record.specifier}' resolved but discovered no component sources`
        );
      }
    }
    // external-package-file-discovery: silence is never an outcome — an
    // unresolvable include warns in non-strict mode and fails the build
    // under strict, naming every offending specifier (vite-plugin parity).
    const unresolvableMessage = unresolvableIncludesMessage(collected.outcomes);
    if (unresolvableMessage !== null) {
      if (this.options.strict) {
        throw new Error(unresolvableMessage);
      }
      this.warn(unresolvableMessage);
    }
    // first-class-extension D13: a stale dist entry under an extended package
    // rides the same strict/warn seam — a merge against it would silently
    // skew registry content the discovered sources no longer match
    // (vite-plugin parity).
    const staleDistMessage = staleDistIncludesMessage(collected.outcomes);
    if (staleDistMessage !== null) {
      if (this.options.strict) {
        throw new Error(staleDistMessage);
      }
      this.warn(staleDistMessage);
    }

    // ── Cross-volume gate (design D5) ──────────────────────────────────
    // A resolved source root on a different platform volume than the
    // project root is rejected AT DISCOVERY — cold init and every reset,
    // never lazily at event time. Strict fails the pipeline (nothing has
    // been published, so a mid-session reset retains the previous
    // generation); non-strict records the sticky diagnostic and excludes
    // the package ATOMICALLY via the shared exclusion helper.
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
        throw new Error(`[animus-next] ${message}`);
      }
      this.stickyDiagnostics.set('cross-volume', message);
    }
    // Sticky surfacing: every retained diagnostic re-warns on every full
    // pipeline until its condition clears (design D5/D7).
    for (const message of this.stickyDiagnostics.values()) {
      this.warn(message);
    }
    const admitted = excludeCollectedPackages(
      collected,
      rejectedSpecifiers,
      rootDir
    );

    // ── Source identity + set-valued ownership (design D2) ─────────────
    // One handle per generation: canonical roots realpath'd here, alias
    // associations seeded from the walked files so a later deletion event
    // under any discovery spelling resolves through the cache.
    const identity = createSourceIdentity(rootDir);
    this.externalRootOwners = new Map();
    this.externalRootExtensions = new Map();
    for (const [dir, specifiers] of Object.entries(admitted.dirOwnerSets)) {
      const canonical = identity.registerExternalRoot(dir);
      const owners = this.externalRootOwners.get(canonical) ?? new Set();
      for (const specifier of specifiers) owners.add(specifier);
      this.externalRootOwners.set(canonical, owners);
      // Persist the exact extension set collection walked this dir with
      // (dist-only roots widen with the entry's own extension): the dirty
      // rewalk and watch-path classification MUST use the same set, or a
      // widened root's files vanish from the rewalk and reconcile as a
      // total deletion.
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
      this.fileCache.set(entry.path, { hash, source: entry.source });
      fileEntries.push({ path: entry.path, source: entry.source, hash });
    }

    this.externalPackageDirs = admitted.packageDirs;

    // Publish external package state for non-owning compiler instances
    setSharedExternalDirs(admitted.packageDirs);
    setSharedExternalEntries(admitted.sourceEntries);

    // Keyframes-only carve-out: external package entries
    // contribute their `Keyframes` collections; consumer system authority
    // is untouched (vite-plugin parity — see PluginContext.applyExternalKeyframes).
    // Scan entries cover EVERY admitted package (src entry or dist entry) —
    // deriving from sourceEntries would silently skip dist-only packages.
    if (this.system && admitted.keyframesScanEntries.size > 0) {
      const api = engineApi();
      const merge = mergeExternalKeyframes(
        (entry, root) => api.scanKeyframesExports(entry, root),
        this.system.keyframesJson,
        admitted.keyframesScanEntries.values(),
        this.rootDir!
      );
      this.system.keyframesJson = merge.keyframesJson;
      // Surfacing stays with the single shared policy point inside
      // runProjectAnalysis (this file performs no local surfacing) —
      // stash for analyzeAndEmit to carry.
      this.externalKeyframesDiagnostics = merge.diagnostics;
    } else {
      // No admitted scan entries: the freshly-loaded system already carries
      // exactly its consumer collections, and diagnostics recorded for
      // packages no longer declared must not ride every later analysis
      // (vite-plugin parity — applyExternalKeyframes' reset arm).
      this.externalKeyframesDiagnostics = [];
    }

    bt.packageResolve = this.elapsed(t);

    // The full pipeline's entry set IS the authoritative universe: prune
    // cache keys it no longer contains, so entries of removed/excluded
    // packages and deleted files never ride later incremental analyses as
    // ghosts (spec: workspace-source-ingestion, "Admitted-to-rejected
    // transition leaves no ghosts").
    const universe = new Set(fileEntries.map((entry) => entry.path));
    for (const key of [...this.fileCache.keys()]) {
      if (!universe.has(key)) this.fileCache.delete(key);
    }

    // Step 5+: hand off to the shared analysis + emit core. Production pass
    // (devMode=false) writes system-props.js unconditionally and logs the
    // extraction report.
    await this.analyzeAndEmit(
      fileEntries,
      packageMap,
      false,
      bt,
      pipelineStart,
      pending
    );

    // Publication succeeded: hand the watching host the admitted root set
    // (design D4 — promote newly opened watchers, replay captured events,
    // close removed roots). A throw above never reaches this, so the host
    // rolls its open-new phase back instead.
    this.onExternalRootsCommitted?.(this.externalWatchRoots);
  }

  /**
   * Reset analysis state for HMR geological reset. Payload write guards go
   * back to null so the next publication reseeds them from the disk
   * envelopes — a byte-identical post-reset artifact is still not
   * rewritten.
   */
  resetForHmr(): void {
    resetAnalysisPromise();
    this.artifactRecords = { manifest: null, inputs: null, styles: null };
    this.lastSystemPropsHash = null;
    clearEngineCache(engineApi);
  }

  /**
   * The (sourceKey, observedSourceHash) pairs of a watch batch — cheap
   * evidence for the status file's pending set on the geological-reset
   * path, where the batch's component edits ride along with the system
   * edit (design D3: loaders wait only on observed inputs).
   */
  private pendingFromBatch(changes: WatchChanges): Array<[string, string]> {
    const { excludePatterns, extensionsSet } = this.resolveScanConfig();
    const pending: Array<[string, string]> = [];
    for (const path of changes.modifiedFiles ?? []) {
      const classified = this.classifyWatchPath(path, {
        excludePatterns,
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

  /**
   * Root-dirty inventory reconciliation (design D3): partition the
   * watcher's change sets into explicit FILE events and external ROOT hits
   * (a reported path that IS an admitted root, or a directory inside one),
   * rewalk each dirty root through the shared discovery policy, diff the
   * SourceId+raw-hash inventory against the previous generation, and merge
   * the reconstructed created/edited/deleted deltas with the explicit
   * events (identity-level dedup happens downstream at the cache gate).
   * Deletion falls out of the inventory diff — webpack may report only the
   * directory (probe-proven).
   */
  private reconcileExternalRoots(changes: WatchChanges): WatchChanges {
    const identity = this.sourceIdentity;
    if (!identity) return changes;
    if (!changes.modifiedFiles && !changes.removedFiles) return changes;
    if (this.externalWatchRoots.length === 0) return changes;

    const { extensionsSet } = this.resolveScanConfig();
    const dirtyRoots = new Set<string>();
    const modified = new Set<string>();
    const removed = new Set<string>();

    // A file event is never a root hit; only directories (or vanished
    // paths with no recorded file identity — a deleted directory, or a
    // child created and gone between events) mark their root dirty.
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
      // The rewalk IS the collection walk (shared walkPackageSources —
      // guardrail G1, one policy) — including the root's own recorded
      // extension set: a dist-only root was collected with a widened set,
      // and rewalking it with the project default would see nothing and
      // reconcile the whole kit as deleted.
      const walked = walkPackageSources(
        root,
        this.externalRootExtensions.get(root) ?? extensionsSet
      );
      if (walked.length === 0 && previous.size > 0) {
        // A vacuous rewalk of a previously-populated root is how a policy
        // drift (extension set, walk filters) presents — make it loud
        // before the diff below reconstructs every entry as a deletion.
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
        // removal path resolves them through cached identity (design D2).
        if (!seen.has(key)) removed.add(entry.abs);
      }
    }

    return { modifiedFiles: modified, removedFiles: removed };
  }

  /**
   * Route one watcher-reported path (design D1/D2): a project-root member
   * (lexical containment — existing local semantics preserved; consumer
   * exclude patterns apply) or an admitted external member (identity
   * resolution with symlink-escape rejection; package-relative excludes
   * mirror the collection walk's filters — guardrail G1, one policy).
   * Returns null for dropped paths.
   */
  private classifyWatchPath(
    absPath: string,
    scan: { excludePatterns: string[]; extensionsSet: ReadonlySet<string> }
  ): { key: string; owningRoot: string | null } | null {
    const ext = extname(absPath);
    const rootDir = this.rootDir!;
    if (isPathWithinRoot(rootDir, absPath)) {
      if (!scan.extensionsSet.has(ext)) return null;
      const rel = relative(rootDir, absPath);
      if (
        scan.excludePatterns.some(
          (pattern) => absPath.includes(pattern) || rel.includes(pattern)
        )
      ) {
        return null;
      }
      return { key: rel, owningRoot: null };
    }
    // External paths gate on their OWNING ROOT's recorded extension set
    // (widened for dist-only roots), so identity resolves before the
    // extension check — a `.mjs` edit inside a dist-only kit must not be
    // dropped by the narrower project set that would make the kit's files
    // one-way removable.
    const resolved = this.sourceIdentity?.resolveSourceId(absPath);
    if (!resolved) return null;
    if (resolved.owningRoot === null) {
      // An out-of-root spelling canonicalizing INTO the project root —
      // the same consumer filters as the lexical local branch.
      if (!scan.extensionsSet.has(ext)) return null;
      if (
        scan.excludePatterns.some((pattern) =>
          resolved.sourceKey.includes(pattern)
        )
      ) {
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

  /**
   * Build file entries from cache: every cached file rides with full source.
   * The v2 engine has NO Rust-side cache (arch-extract-v2-spine: uncached
   * re-analysis beats a cache-hit path), so it must always receive full sources
   * (openspec: retire-extract-v1 removed the v1 empty-source cache contract).
   */
  private buildFileEntriesFromCache(): FileEntry[] {
    const entries: FileEntry[] = [];
    for (const [path, { hash, source }] of this.fileCache) {
      entries.push({ path, source, hash });
    }
    return entries;
  }

  /**
   * Run incremental pipeline with cache-aware file entries.
   * Reuses system config from the last full pipeline run.
   */
  private async runIncrementalPipeline(
    fileEntries: FileEntry[],
    pending: Array<[string, string]> = []
  ): Promise<void> {
    const bt: Record<string, number> = {};
    const pipelineStart = this.now();

    // Replay the FULL package map resolved during the last full pipeline;
    // the incremental pass never re-discovers external packages. Deriving it
    // from externalSourceEntries would silently drop dist-resolved packages
    // (those have no src/index.ts and live only in the package map).
    await this.analyzeAndEmit(
      fileEntries,
      this.lastPackageMap,
      true,
      bt,
      pipelineStart,
      pending
    );
  }

  /**
   * Shared analysis + emit core for both pipelines — the single call site
   * that routes every manifest through the shared `runProjectAnalysis`,
   * reachable from both runFullPipeline (production) and
   * runIncrementalPipeline (HMR).
   *
   * Owns diagnostic surfacing, CSS assembly + styles.css write guard,
   * system-props module emit, and the timing log. The `devMode` flag is the
   * ONLY behavioral fork:
   *
   * - `false` (production): computes bt.analysis + logs the extraction
   *   report, and writes system-props.js UNCONDITIONALLY (no
   *   lastSystemPropsHash guard).
   * - `true` (HMR): skips the report log, and guards the system-props.js
   *   write by lastSystemPropsHash.
   *
   * The disk artifacts land under the session directory in transaction
   * order (design D1): manifest → analysis-inputs (Turbopack orchestration
   * only) → styles.css → system-props → analysis-commit →
   * replacements-epoch (last, only when moved). The analysis-status file walks starting → analyzing →
   * committing → idle around the attempt, landing in `failed` (with the
   * diagnostic) on any throw (design D3).
   */
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
      this.writeAnalysisStatus('idle', []);
    } catch (err) {
      // Failed analyses publish no partial generation (shared DSTC spec):
      // nothing above advanced any artifact; the status carries the
      // diagnostic for the loader's decision table.
      this.writeAnalysisStatus('failed', pending, String(err));
      throw err;
    }
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
      devMode,
    };

    this.writeAnalysisStatus('analyzing', pending);
    const result = runProjectAnalysis(engineApi, {
      ...analysisOptions,
      warn: (message) => this.warn(message),
      strict: this.options.strict,
      extraDiagnostics: this.externalKeyframesDiagnostics,
    });

    // Error-diagnostic escalation (extraction-diagnostics §Error diagnostics
    // fail the build, design D8): the shared gate throws on any
    // `kind: "error"` entry in EVERY mode, at the same accept seam as the
    // vite plugin — before token contracts and before any stylesheet is
    // assembled or written, so the outer analyzeAndEmit catch records the
    // failed status with no partial generation.
    assertNoErrorDiagnostics(result.manifest?.diagnostics);

    // Cross-source token contracts (extraction-diagnostics): engine
    // candidates × file ownership × source-token witness → the teaching
    // error naming token, component, package, and the missing
    // `createTheme().extend(...)`. Wiring and severity routing live in the
    // shared pipeline gate (vite-plugin parity by construction).
    enforceExternalTokenContracts({
      diagnostics: result.manifest?.diagnostics,
      fileOwners: this.externalFileOwners,
      dirOwners: this.externalDirOwners,
      sourceThemeManifestsJson: system.sourceThemeManifestsJson,
      strict: this.options.strict,
      prefix: '[animus-next]',
      warn: (message: string) => this.warn(message),
    });

    bt.jsonSerialize = result.timings.serializeMs;
    bt.rustExtract = result.timings.extractMs;
    bt.jsonParse = result.timings.parseMs;

    const manifest = result.manifest;

    if (!devMode) {
      bt.analysis =
        (bt.jsonSerialize ?? 0) + (bt.rustExtract ?? 0) + (bt.jsonParse ?? 0);
      if (manifest?.report) {
        this.log(
          `Extracted ${manifest.report.components_extracted ?? '?'}/${manifest.report.components_total ?? '?'} components (${bt.analysis}ms)`
        );
      }
    }

    // asset() placeholder substitution (global-styles-system) happens before
    // assembly so every consumer of the CSS (shared copy, disk artifact,
    // Turbopack hydration) receives substituted urls.
    const globalCss = this.substituteAssetReferences(result.globalCss, devMode);

    // Assemble full stylesheet (canonical order via shared function)
    const { declaration, variables, body } = assembleStylesheet({
      layers: this.options.layers,
      variableCss: system.variableCss,
      globalCss,
      componentCss: result.componentCss,
      split: true,
    });

    // Post-process the BODY only (spec: css-post-processing) — the @layer
    // declaration and variable CSS pass through untouched. Every consumer
    // (processAssets shared copy, disk artifact, Turbopack) receives the
    // processed bytes.
    if (this.lcssTargets === null) {
      this.lcssTargets = resolveLightningTargets(
        this.options.targets,
        this.rootDir!
      );
    }
    const processedBody = postProcessCss(body, {
      minify: this.options.minify ?? process.env.NODE_ENV === 'production',
      targets: this.lcssTargets,
      warnFn: (msg) => this.warn(msg),
    });

    const fullCss = [declaration, variables, processedBody]
      .filter(Boolean)
      .join('\n');

    // Store CSS in shared variable (authoritative source for processAssets)
    setSharedCss(fullCss);

    // Build system-props module for runtime resolution via the shared
    // generator (transforms resolve at extraction time in Rust).
    const systemPropsContent = buildSystemPropsModule({
      systemPropMapJson: JSON.stringify(manifest?.system_prop_map ?? {}),
      groupRegistryJson: system.groupRegistryJson,
      dynamicProps: (manifest?.dynamic_props ?? {}) as Record<
        string,
        DynamicPropMeta
      >,
    });

    setSharedSystemProps(systemPropsContent);

    // Store manifest for loader
    setManifestJson(result.manifestJson);

    // Publish the analyzed-hash map with the manifest (one generation, one
    // publication): the exact bytes this analysis saw, keyed by relPath —
    // the loader's mismatch witness for ANIMUS_ANALYSIS_CATCHING_UP
    // (design D4).
    setAnalyzedHashes(
      new Map(fileEntries.map((entry) => [entry.path, entry.hash]))
    );

    // ── Disk transaction (design D1) ────────────────────────────────────
    // Payloads first (manifest → inputs → styles, plus system-props), then
    // the analysis-commit carrying content hashes of the disk bytes, then
    // the replacement epoch LAST and only when its value moved — a reader
    // awakened by the epoch can never observe an uncommitted transaction,
    // and a throw anywhere above leaves the previous commit current.
    this.writeAnalysisStatus('committing', pending);

    // The served system-props module rides as the epoch's served-dependency
    // witness: webpack's restored modules import the building session's
    // system-props.js by absolute path, so content changes the plans can't
    // see (an offline group-registry edit) must still move the epoch — a
    // preserved epoch would keep those restored modules bound to the dead
    // session's stale artifact.
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
    // Hydration artifact for isolated Turbopack loader workers — the exact
    // analyze-time input set, replayable via buildAnalyzeProjectArgs.
    // Serialized + written under Turbopack orchestration ONLY (spec:
    // next-turbopack-integration, "Webpack mode skips the hydration
    // corpus" — the webpack loader shares this process and reads the
    // manifest from memory). `analyzedHashes` rides top-level (covered by
    // the commit's inputsHash) so loader workers read the per-file hash map
    // without parsing the whole filesJson source corpus.
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
      // HMR: skip the disk write when byte-identical to the last one written.
      const systemPropsHash = contentHash(systemPropsContent);
      if (systemPropsHash !== this.lastSystemPropsHash) {
        this.writeSessionArtifact(SYSTEM_PROPS_ARTIFACT, systemPropsContent);
        this.lastSystemPropsHash = systemPropsHash;
      }
    } else {
      // Production: write unconditionally (no lastSystemPropsHash guard).
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

  /** Write the session's analysis-status artifact (design D3). Terminal
   *  states (idle/failed) close the attempt. */
  private writeAnalysisStatus(
    state: AnalysisStatus['state'],
    pending: Array<[string, string]>,
    diagnostic?: string
  ): void {
    const status: AnalysisStatus = {
      schema: 1,
      sessionId: this.sessionId,
      attemptId: this.statusAttemptId,
      state,
      pending,
      deadlineAt: Date.now() + this.debounceCeilingMs + STATUS_WATCHDOG_MS,
      ...(diagnostic !== undefined ? { diagnostic } : {}),
    };
    this.writeSessionArtifact(ANALYSIS_STATUS_ARTIFACT, JSON.stringify(status));
    if (state === 'idle' || state === 'failed') {
      this.statusAttemptOpen = false;
    }
  }

  /**
   * Orchestrator seam (Turbopack watcher): record watch events observed
   * during the debounce window so a loader running ahead of the analysis
   * has positive evidence to wait on (design D3 'debouncing'). Paths are
   * filtered by the scan config and hashed at observation time.
   */
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
      // The burst may have been consumed already (analyzeAndEmit clears
      // debouncePending and writes its own states) — never clobber a later
      // state with a stale 'debouncing'.
      if (this.debouncePending.size === 0) return;
      // The microtask runs OUTSIDE the fs.watch handler's try/catch (the
      // caller's guard ended when this tick was scheduled), and this can be
      // the first-ever write into the session dir — EMFILE/ENOSPC/EACCES
      // here must not escape a bare microtask and kill the dev server. A
      // missed status write only lengthens a loader's catch-up wait.
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

  /**
   * Write one payload artifact into the session directory, enveloped with
   * `{sessionId, generation, replacementEpoch, payloadHash}` and rewritten
   * only when the PAYLOAD bytes changed (byte-identical re-analyses leave
   * disk untouched — spec: "Unchanged manifest is not rewritten"). The
   * recorded diskHash (hash of the enveloped bytes) feeds the
   * analysis-commit.
   */
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
  ): { payloadHash: string; diskHash: string } | null {
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
    if (!envelope || typeof envelope.payloadHash !== 'string') return null;
    return { payloadHash: envelope.payloadHash, diskHash: contentHash(bytes) };
  }

  /** Last analysis-commit persisted in this session's directory, or null. */
  private seedCommitFromDisk(): AnalysisCommit | null {
    try {
      const parsed = JSON.parse(
        readFileSync(analysisCommitPath(this.sessionDir), 'utf-8')
      ) as AnalysisCommit;
      return parsed.schema === 1 &&
        parsed.sessionId === this.sessionId &&
        typeof parsed.generation === 'number'
        ? parsed
        : null;
    } catch {
      return null;
    }
  }

  /**
   * Publish the analysis-commit — the transaction identity (design D1).
   * Written AFTER every payload and BEFORE the epoch; skipped entirely when
   * the payload set (disk hashes) and epoch are unchanged, so a no-op
   * re-analysis neither re-keys loader-worker hydration nor burns a
   * generation.
   */
  private publishAnalysisCommit(epoch: string, generation: number): void {
    const manifestHash = this.artifactRecords.manifest?.diskHash ?? '';
    // Webpack mode persists no hydration corpus, so its commit carries no
    // inputsHash field at all (spec: "Webpack mode skips the hydration
    // corpus"; the seqlock reader only verifies hashes for artifacts it
    // reads).
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
      ...(inputsHash !== undefined ? { inputsHash } : {}),
      stylesHash,
    };
    this.writeSessionArtifact(ANALYSIS_COMMIT_ARTIFACT, JSON.stringify(commit));
    this.lastCommit = commit;
  }

  /**
   * Publish the canonical replacement epoch: maintain the session-scoped
   * disk witness `{schema, sessionId, epoch}`, rewritten ONLY when the
   * epoch VALUE changes so style-only analyses and same-session restarts
   * leave bytes and mtime untouched, then expose the value through the
   * singleton for the plugin's needBuild fan-out and the loader's catch-up
   * re-check. Every VALUE move also reconciles sibling sessions' epoch
   * artifacts (below) — the webpack cold-cache validity witness.
   */
  private publishReplacementEpoch(epoch: string): void {
    if (this.lastEpochValue === null) {
      this.lastEpochValue = this.diskEpochValue();
    }
    if (epoch !== this.lastEpochValue) {
      this.writeSessionArtifact(
        REPLACEMENT_EPOCH_ARTIFACT,
        JSON.stringify({ schema: 1, sessionId: this.sessionId, epoch })
      );
      this.lastEpochValue = epoch;
      this.reconcileSiblingEpochs(epoch);
    }
    setReplacementEpoch(epoch);
  }

  /**
   * Sibling epoch reconciliation — the cross-session half of the webpack
   * persistent-cache witness (spec: dev-served-transform-coherence,
   * "Offline change invalidates restored modules"). Restored-module
   * snapshots reference the epoch artifact of the session that BUILT them;
   * with session-scoped trees that file would otherwise sit untouched
   * forever, keeping stale snapshots valid. Whenever this session's epoch
   * value moves, delete every sibling epoch artifact that disagrees (their
   * snapshots must invalidate — restore-on-demand then rebuilds from the
   * current generation) and leave agreeing siblings byte-untouched (warm
   * restores stay valid). Deleting a stale artifact is pruning, not a
   * foreign-session write; races with concurrent sessions are tolerated
   * (S14).
   */
  /** Sibling ids already reconciled away (artifact deleted or absent) —
   *  nothing left to invalidate for them on later moves. */
  private reconciledSiblingIds = new Set<string>();
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
      if (this.reconciledSiblingIds.has(entry)) continue;
      const siblingEpochPath = join(
        rootPath,
        entry,
        REPLACEMENT_EPOCH_ARTIFACT
      );
      try {
        const parsed = JSON.parse(readFileSync(siblingEpochPath, 'utf-8')) as {
          epoch?: string;
        };
        // Agreeing siblings stay byte-untouched AND stay candidates — a
        // later epoch value can turn them stale.
        if (parsed.epoch === epoch) continue;
      } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
          this.reconciledSiblingIds.add(entry);
          continue;
        }
        // Unreadable/corrupt sibling artifact: fall through to deletion —
        // fail-safe invalidation beats a stale-but-valid snapshot.
      }
      try {
        unlinkSync(siblingEpochPath);
      } catch {
        // Concurrent prune/removal — the invalidation already happened.
      }
      this.reconciledSiblingIds.add(entry);
    }
  }

  /** Epoch value held by this session's on-disk artifact, or null when
   *  absent, unreadable, or not the expected schema. */
  private diskEpochValue(): string | null {
    try {
      const parsed = JSON.parse(
        readFileSync(replacementEpochPath(this.sessionDir), 'utf-8')
      ) as { schema?: number; epoch?: string };
      return parsed.schema === 1 && typeof parsed.epoch === 'string'
        ? parsed.epoch
        : null;
    } catch {
      return null;
    }
  }

  /** Session-start hygiene (design D2): delete legacy flat artifacts
   *  (unreachable by session-scoped loaders) and prune sibling session
   *  directories older than the retention window — never the own dir,
   *  tolerating races with concurrently-pruning sessions (S14). */
  private runSessionStartHygiene(): void {
    if (this.sessionStartHygieneDone) return;
    this.sessionStartHygieneDone = true;
    const animusDir = join(this.rootDir!, '.animus');
    for (const name of LEGACY_FLAT_ARTIFACTS) {
      try {
        unlinkSync(join(animusDir, name));
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
        if (statSync(dir).mtimeMs < cutoff) {
          rmSync(dir, { recursive: true, force: true });
        }
      } catch {
        // raced away — another live session may be pruning too
      }
    }
  }

  /** Ensure the session directory exists and write one artifact into it.
   *  Write-then-rename so cross-process readers (Turbopack loader workers)
   *  can never observe a torn half-written file. The tmp name carries the
   *  pid — Next dev evaluates the config in more than one process, and two
   *  sessions writing the same artifact must not race on one tmp path. */
  private writeSessionArtifact(name: string, content: string): void {
    const dir = this.sessionDir;
    // Unconditional: mkdirSync(recursive) is a no-op when the dir exists.
    mkdirSync(dir, { recursive: true });
    const tmpPath = join(dir, `.${name}.${process.pid}.tmp`);
    writeFileSync(tmpPath, content);
    renameSync(tmpPath, join(dir, name));
    this.onArtifactWrite?.(name, content);
  }

  /**
   * asset() placeholder substitution (global-styles-system): resolve each
   * referenced specifier through Node resolution, copy the bytes into the
   * session directory's `assets/` under a content-hashed name, and
   * substitute a RELATIVE url — relative to the session-scoped styles.css,
   * which sits beside `assets/`, so the emitted `./assets/<file>` form is
   * unchanged. The stylesheet is processed by Next's own CSS pipeline
   * (webpack and Turbopack alike), which applies its native asset handling
   * — publicPath and output hashing — to relative url() references.
   * Unsubstitutable specifiers warn and emit literally in non-strict mode,
   * fail the build under `strict: true`.
   */
  private substituteAssetReferences(
    globalCss: string,
    devMode: boolean
  ): string {
    const specifiers = findAssetSpecifiers(globalCss);
    const assetsDir = join(this.sessionDir, SESSION_ASSETS_DIR);
    const expected = new Set<string>();
    this.assetDependencyPaths.clear();
    this.assetDependencyKeys.clear();

    const urlBySpecifier = new Map<string, string>();
    for (const specifier of specifiers) {
      // This runs per HMR rebuild; the resolve/read/hash/copy result is
      // stable for the lifetime of a loaded system, so a memo (cleared on
      // system load) reduces steady-state passes to one existsSync each.
      // A missing copy (concurrent prune) falls through and self-heals.
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
        if (this.options.strict) throw new Error(`[animus-next] ${message}`);
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
      const url = `./assets/${fileName}`;
      urlBySpecifier.set(specifier, url);
      this.assetCopyCache.set(specifier, {
        sourcePath: resolvedPath,
        mtimeMs: sourceStat.mtimeMs,
        size: sourceStat.size,
        fileName,
        url,
      });
    }

    // Content-hashed copies are never overwritten, so superseded revisions
    // (and copies of assets no longer referenced at all) accumulate without
    // this sync — runs AFTER the writes so the current set is always on
    // disk, including when no asset() remains and everything is stale.
    if (!devMode) pruneStaleAssets(assetsDir, expected);

    return substituteAssetPlaceholders(globalCss, urlBySpecifier);
  }

  private trackAssetDependency(path: string): void {
    this.assetDependencyPaths.add(path);
    for (const key of toWatchKeys(path)) this.assetDependencyKeys.add(key);
  }

  /**
   * Resolve an asset specifier to an absolute file via the shared pipeline
   * resolver (host aliases → Node resolution → package root), with one
   * session-local last resort: an already-discovered source entry's package
   * root (dist-less workspace kits the shared resolver cannot see).
   */
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

/**
 * Sync `.animus/assets/` to the current build's content-hashed file set:
 * anything else in the directory is a superseded revision (the copies are
 * content-addressed and never overwritten) or the leftover of an asset()
 * reference that no longer exists. Failures are tolerated per entry — Next
 * dev evaluates the config in more than one process, and a concurrent
 * session may have removed (or be about to rewrite) the same file; every
 * pass rewrites whatever of its own set is missing, so races self-heal.
 */
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
