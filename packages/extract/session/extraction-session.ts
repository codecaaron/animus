import { randomUUID } from 'crypto';
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
import { basename, extname, isAbsolute, join, relative, resolve } from 'path';

import {
  assembleStylesheet,
  buildSystemPropsModule,
  BUILT_IN_EXTENSION_POLICY,
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
  nativeKitSourceRoot,
  importedKitDiagnostics,
  findPackageRoot,
  findSheetAssetSpecifiers,
  firstOwners,
  hashReplacementPlans,
  isExcludedPackageRelativePath,
  isPathWithinRoot,
  declaredWorkspacePackages,
  extensionPolicyJson,
  loadSystemConfig,
  outputSourceGuard,
  outputSourceMessage,
  postProcessCss,
  projectExternalFileOwners,
  resolveAssetFile,
  resolveLightningTargets,
  resolveMode,
  resolveVerbosity,
  runProjectAnalysis,
  serializeStaticCss,
  sharesVolumeRoot,
  snapshotFilePlans,
  staleDistIncludesMessage,
  generatedModuleCode,
  reportSurvivingAssetPlaceholders,
  substituteSheetAssets,
  toWatchKeys,
  isDeletedSource,
  unreadableSourceDiagnostic,
  unmatchedExcludeLines,
  unresolvableIncludesMessage,
  walkPackageSources,
  engineModuleParser,
  surfaceManifestDiagnostics,
} from '../pipeline/index';
import { COALESCING_WINDOW_MS } from './coalescing-window';
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
  createBuildId,
  engineApi,
  findSession,
  joinSession,
  sessionKey,
  getOwningWatchSession,
  claimUnmatchedExcludeReport,
  getManifestJson,
  getSystemAuthority,
  holdBuildClaimRecord,
  leaveSession,
  getWatchTransaction,
  observationQueue,
  SessionConfigurationConflict,
  setSystemAuthority,
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
  setSharedExternalSideEffects,
  setSharedSystemProps,
  setWatchTransaction,
} from './singleton';
import { logBuildTimings } from './timing';

import type {
  AnimusCoreOptions,
  ExternalPackageOutcome,
  HostExtensionPolicy,
  KitDescriptorRecord,
} from '../pipeline/index';
import type {
  PackageResolution,
  SessionResolutionContext,
} from './resolve-packages';
import type { SessionKey, SystemLoad } from './singleton';

export type SessionOptions = AnimusCoreOptions;

/** An observation's state when its file is gone, or cannot be read; any
 *  other state is the content hash it was observed with. */
const REMOVED_OBSERVATION = 'removed';
const UNREADABLE_OBSERVATION = 'unreadable';

/** A loaded system's identity: its evaluated modules and a fingerprint of
 *  the whole load. */
function systemLoad(system: SystemConfig): SystemLoad {
  return {
    identity: contentHash(JSON.stringify(system)),
    dependencies: system.dependencies ?? [],
  };
}

/** What an attempt takes from the build's queue: every untaken
 *  observation, and whether a full rescan is requested. */
interface TakenObservations {
  taken: Map<string, string>;
  rescan: boolean;
}

/** What the hosting bundler does, which the user does not configure. */
export interface SessionHost {
  /** The build this session takes part in, created once by the owning host
   *  wrapper and passed to every participant and worker. Omitted, the
   *  session is a build of its own. */
  build?: string;
  /** The bundler leaves an `import(expr)` it cannot read unbundled
   *  (Rollup, Vite, Turbopack), so the load reaches no analysed module.
   *  Omitted, it reaches the importer's directory, as a webpack context
   *  does. */
  unbundledComputedImports?: boolean;
}

import type { AnimusMode, ExcludeMatcher, Verbosity } from '../pipeline/index';
import type {
  AssetSheets,
  IngestionOpening,
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

/** Rejection of an attempt whose corpus holds an aborted parse. */
class AbortedParseRejection extends Error {}

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
  /** The host's export conditions, in its order, for the system loader. */
  conditions: readonly string[] = [];
  /** The host's extension order, as its adapter captured it; the built-in
   *  policy where no host resolves. */
  extensionPolicy: HostExtensionPolicy = BUILT_IN_EXTENSION_POLICY;

  // Per-specifier asset resolve/copy memo — stable per loaded system, so
  // loading a system clears it.
  private assetCopyCache = new Map<
    string,
    {
      sourcePath: string;
      /** The content hash the copy was made from. */
      digest: string;
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
  /** Whether this session serves development (a watch), where an error-level
   *  diagnostic is reported and the session keeps running. Only a build
   *  fails on one. */
  development = false;

  /** Absolute directory prefixes for external packages (loader allowlist). */
  externalPackageDirs: string[] = [];
  /** Those whose package is linked rather than installed. */
  externalLinkedDirs: string[] = [];
  /** Those read from their package's compiled output. */
  externalOutputDirs: string[] = [];
  /** Absolute package dir → owning specifier (cross-source correlation). */
  private externalDirOwners: Record<string, string> = {};
  /** rootDir-relative external file → owning specifier (correlation join). */
  private externalFileOwners: Record<string, string> = {};
  /** External package specifier → absolute source entry path. */
  externalSourceEntries = new Map<string, string>();
  /** Specifier → its source entry's side effects, from the owning package's
   *  `sideEffects`; absent leaves the bundler's own classification. */
  externalSourceSideEffects = new Map<string, boolean>();
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
  /** Configured files that could not be read. Incremental passes replay
   *  these instead of passing strict, and add a watched change they cannot
   *  read. */
  private ingestionFailureDiagnostics: ManifestDiagnostic[] = [];
  /** Whether the corpus being analyzed left a file out, whose renders the
   *  analysis cannot see. */
  private skippedSources: readonly string[] = [];
  /** Resolver calls ingestion ended under another spelling. */
  private ingestionOpenings: readonly IngestionOpening[] = [];
  /** Full package-resolution map from the last full pipeline — replayed by
   *  incremental passes (sourceEntries alone omits dist-resolved packages). */
  private lastPackageMap: Record<string, string> = {};

  // Raw/original paths and hashes only. Generated MDX/Svelte parser entries
  // live in the published source corpus.
  private fileCache = new Map<string, { hash: string; source: string }>();

  readonly corpus: SourceCorpus = createSourceCorpus({
    engineApi: () => engineApi(this.key),
    prefix: '[animus-next]',
    strict: () => !!this.options.strict,
    warn: (message: string) => this.warn(message),
    reportErrors: () => this.reportErrors(),
    extensions: () => this.extensionPolicy,
    rootDir: () => this.rootDir!,
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
  /** The build this session takes part in: every participant of one build
   *  shares its artifact tree and state; another build of the root never
   *  does. */
  readonly sessionId: string;
  /** The log tier, from the option and `ANIMUS_DEBUG` at construction. */
  private readonly verbosity: Verbosity;
  /** The emission mode at construction: explicit, else `NODE_ENV`'s. It
   *  defaults minify. */
  private readonly startupMode: AnimusMode;
  private joinedKey: SessionKey | null = null;
  /** This instance as a participant of its build, once joined. */
  private participant: string | null = null;
  /** Closed: it left its build and starts no attempt until it reattaches. */
  private detached = false;
  /** Epoch of the last published analysis; null seeds from disk so a
   *  same-session restart with unchanged plans rewrites no bytes. */
  private lastEpochValue: string | null = null;
  /** Watcher debounce ceiling feeding status deadlines. */
  debounceCeilingMs = COALESCING_WINDOW_MS;
  /** Test seam: observes every session-artifact write (name, content)
   *  post-rename — write ORDER is part of the transaction contract. */
  onArtifactWrite: ((name: string, content: string) => void) | null = null;
  private statusAttemptId = 0;
  private statusAttemptOpen = false;
  /** Message of the aborted-parse rejection holding publication. While set,
   *  the cache keeps every observed source so the repair publishes them in
   *  one generation; a successful publication clears it. */
  private heldRejection: string | null = null;
  /** A system reload an aborted parse rejected. Its dependency hashes already
   *  advanced, so the first batch that passes the parse check publishes
   *  through the full pipeline, which loads the latest system. */
  private systemReloadOwed = false;
  /** Monotonic readiness witness: flips true on the first complete
   *  publication and never regresses; every later status write carries it. */
  private firstEmissionComplete = false;
  /** Debounce-window observations pending analysis (sourceKey → hash). */
  private debouncePending = new Map<string, string>();
  private sessionStartHygieneDone = false;
  // Lightning CSS targets — resolved lazily once per session (browserslist
  // config I/O).
  private lcssTargets: LightningTargets | null = null;

  constructor(
    options: SessionOptions,
    private readonly host: SessionHost = {}
  ) {
    this.options = options;
    this.sessionId = host.build ?? createBuildId();
    // Serialized once (stable key order) so the analysis-inputs hash is
    // insensitive to option-object identity.
    this.staticCssJson = serializeStaticCss(options.staticCss);
    // Startup inputs, captured once (SA2, SA3): no later stage reads
    // `ANIMUS_DEBUG` or `NODE_ENV`.
    this.verbosity = resolveVerbosity(
      options.verbose,
      process.env.ANIMUS_DEBUG
    );
    this.startupMode = resolveMode(options.mode, () =>
      process.env.NODE_ENV === 'production' ? 'production' : 'development'
    ).mode;
  }

  /** Forgets that `relPath` could not be read once an incremental pass reads
   *  or deletes it, so its cost stops holding pruning off. Whether one was
   *  recorded. */
  private clearIngestionFailure(relPath: string): boolean {
    const before = this.ingestionFailureDiagnostics.length;
    this.ingestionFailureDiagnostics = this.ingestionFailureDiagnostics.filter(
      (diagnostic) => diagnostic.file !== relPath
    );
    return this.ingestionFailureDiagnostics.length !== before;
  }

  get sessionDir(): string {
    return sessionArtifactDir(this.rootDir!, this.sessionId);
  }

  /** This session's build of its root, joined on first use: a participant
   *  whose options differ from the build's fails with
   *  `SessionConfigurationConflict`. */
  get key(): SessionKey {
    if (this.joinedKey === null) {
      const key = sessionKey(this.sessionId, this.rootDir!);
      // Unique across module copies (ESM and CJS), which share the registry.
      const participant = `${this.driverLabel}#${randomUUID()}`;
      joinSession(key, participant, this.options);
      this.participant = participant;
      this.joinedKey = key;
    }
    return this.joinedKey;
  }

  get verbose(): boolean {
    return this.verbosity !== 'quiet';
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

  private reportErrors(): ((message: string) => void) | undefined {
    return this.development ? (message) => console.error(message) : undefined;
  }

  /** A build-strictness check that failed: a build throws `message`, and
   *  development reports it at error level and takes the non-strict path. */
  private strictFailure(message: string): void {
    const report = this.reportErrors();
    if (!report) throw new Error(message);
    report(message);
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
  /** The analysed kits' descriptors, from the last discovery. */
  kitDescriptors: KitDescriptorRecord[] = [];

  /** Component count of the last published analysis, null before the first —
   *  read by drivers instead of re-parsing the manifest JSON every cycle. */
  lastComponentCount: number | null = null;

  /** The loaded theme's token → variable map; null before the system loads. */
  get variableMapJson(): string | null {
    return this.system?.variableMapJson ?? null;
  }

  /** When superseded asset copies leave `assets/`: `'full-pipeline'` suits a
   *  driver serving the dir in place, `'every-cycle'` one republishing it. */
  staleAssetPruning: 'full-pipeline' | 'every-cycle' = 'full-pipeline';

  /** The host's output directories (`outputExclusion`): root-relative,
   *  excluded as literal path prefixes from discovery and from package
   *  collection, whatever the user's list. */
  structuralExclude: string[] = [];

  private scanConfigMemo: {
    excludeMatcher: ExcludeMatcher;
    extensionsSet: ReadonlySet<string>;
  } | null = null;

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

  /** Records the batch before any await, so an attempt that rejects never
   *  erases it, and settles with the attempt that takes it (SA20). */
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
    const hasBatch =
      (changes.modifiedFiles?.size ?? 0) > 0 ||
      (changes.removedFiles?.size ?? 0) > 0;
    if (hasBatch) {
      await this.awaitObservation(this.recordObservation(changes));
      return;
    }
    // No observation: an in-flight attempt answers the call, and otherwise
    // the owner runs it (absent change sets probe every file).
    const inflight = getWatchTransaction(this.key);
    if (inflight) {
      await inflight;
      return;
    }
    if (this.system && !this.detached) await this.runWatchAttempt(changes);
  }

  /** Queues the batch's observations under a new revision, synchronously.
   *  A batch equivalent to what the active attempt took joins that attempt:
   *  a second compiler's report of the same edit never analyzes it twice. */
  private recordObservation(changes: WatchChanges): number {
    const queue = observationQueue(this.key);
    const observed = new Map<string, string>();
    for (const path of changes.modifiedFiles ?? []) {
      let state: string;
      try {
        state = contentHash(readFileSync(path, 'utf-8'));
      } catch {
        state = UNREADABLE_OBSERVATION;
      }
      observed.set(path, state);
    }
    for (const path of changes.removedFiles ?? []) {
      observed.set(path, REMOVED_OBSERVATION);
    }
    const revision = ++queue.revision;
    const active = queue.active;
    // A path with a queued observation is never equivalent: this newer
    // observation supersedes the queued one, so it is queued in its place.
    if (
      active !== null &&
      [...observed].every(
        ([path, state]) =>
          !queue.untaken.has(path) && active.taken.get(path) === state
      )
    ) {
      queue.revisions.set(revision, active.transaction);
      return revision;
    }
    for (const [path, state] of observed) queue.untaken.set(path, state);
    queue.revisions.set(revision, null);
    return revision;
  }

  /** Settles with the attempt that takes `revision`. Another attempt's
   *  rejection is its own callers': this observation runs after it. */
  private async awaitObservation(revision: number): Promise<void> {
    const queue = observationQueue(this.key);
    for (;;) {
      const taken = queue.revisions.get(revision);
      if (taken !== null && taken !== undefined) {
        queue.revisions.delete(revision);
        await taken;
        return;
      }
      const inflight = getWatchTransaction(this.key);
      if (inflight) {
        await inflight.catch(() => undefined);
        continue;
      }
      const owner =
        this.system && !this.detached ? this : getOwningWatchSession(this.key);
      if (
        owner === null &&
        !this.detached &&
        getManifestJson(this.key) !== null
      ) {
        // The publisher left a build this participant still uses: it takes
        // over, and its full read settles the queued observations.
        await this.runFullPipeline();
        continue;
      }
      if (owner === null || !owner.startObservedAttempt()) {
        // No session of the build can analyze yet: the observation stays
        // queued for the owner's next attempt.
        queue.revisions.delete(revision);
        return;
      }
    }
  }

  /** Starts one attempt over every untaken observation of the build. */
  startObservedAttempt(): boolean {
    if (!this.system || this.detached) return false;
    const { taken, rescan } = this.takeObservations();
    const modifiedFiles = new Set<string>();
    const removedFiles = new Set<string>();
    for (const [path, state] of taken) {
      (state === REMOVED_OBSERVATION ? removedFiles : modifiedFiles).add(path);
    }
    this.settleTaken(
      taken,
      this.runWatchAttempt({ modifiedFiles, removedFiles }, rescan)
    );
    return true;
  }

  /** Every untaken observation of the build, and whether a full rescan is
   *  requested, which the caller's attempt now covers. */
  private takeObservations(): TakenObservations {
    const queue = observationQueue(this.key);
    const taken = new Map(queue.untaken);
    const rescan = queue.rescan;
    queue.untaken.clear();
    queue.rescan = false;
    return { taken, rescan };
  }

  /** `transaction` settles every waiting revision, and is the active
   *  attempt equivalent observations join until it settles. */
  private settleTaken(
    taken: Map<string, string>,
    transaction: Promise<void>
  ): void {
    const queue = observationQueue(this.key);
    for (const [revision, attempt] of queue.revisions) {
      if (attempt === null) queue.revisions.set(revision, transaction);
    }
    queue.active = { taken, transaction };
    const settle = () => {
      if (queue.active?.transaction === transaction) queue.active = null;
    };
    transaction.then(settle, settle);
  }

  /** Registers one attempt in the build's single-flight slot before it
   *  processes, so a nested full system reload inherits the gate rather
   *  than clear it, and clears the slot when it settles either way. */
  private runWatchAttempt(
    changes: WatchChanges,
    rescan = false
  ): Promise<void> {
    // A rescan is a full read, nested in this attempt's slot.
    const transaction = Promise.resolve().then(() =>
      rescan ? this.runFullPipeline() : this.processWatchUpdate(changes)
    );
    setWatchTransaction(this.key, transaction);
    const settle = () => {
      if (getWatchTransaction(this.key) === transaction) {
        setWatchTransaction(this.key, null);
      }
    };
    transaction.then(settle, settle);
    return transaction;
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
        setAnalysisStartedPromise(this.key, promise);
        await promise;
        this.systemReloadOwed = false;
      } catch (err) {
        if (err instanceof AbortedParseRejection) this.systemReloadOwed = true;
        // A failed reset re-run is a failed cycle, not a fallback: swallowing
        // it would republish against the stale system. The status write is not
        // redundant: the system load throws before the analyze-and-emit status
        // wrapper opens, so nothing else records this failure for the host.
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
        this.clearIngestionFailure(key);
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
    const inOutput = outputSourceGuard(rootDir, this.structuralExclude);
    // A read that fails or recovers changes the report, even with no source
    // change.
    let readFailuresChanged = false;

    for (const target of targets) {
      const relPath = target.key;
      const outputDir = inOutput(target.abs);
      if (outputDir !== null) {
        this.warn(outputSourceMessage(relPath, outputDir));
        continue;
      }
      let source: string;
      try {
        source = readFileSync(target.abs, 'utf-8');
      } catch (err) {
        // Benign race: the file vanished between the watch event and this
        // read — it will surface in removedFiles on the next watch cycle.
        if (isDeletedSource(err)) continue;
        // Reported with its cause, and held as unseen so nothing is pruned.
        // The analysis keeps its last readable source, so no live CSS is
        // lost; the next readable event replaces it.
        this.clearIngestionFailure(relPath);
        this.ingestionFailureDiagnostics = [
          ...this.ingestionFailureDiagnostics,
          unreadableSourceDiagnostic(relPath, err),
        ];
        readFailuresChanged = true;
        continue;
      }
      // A file read now no longer costs the analysis its renders.
      if (this.clearIngestionFailure(relPath)) readFailuresChanged = true;
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

    if (
      changedPaths.length > 0 ||
      removedAny ||
      readFailuresChanged ||
      assetChanged
    ) {
      const pending: Array<[string, string]> = changedPaths.map((rel) => [
        rel,
        this.fileCache.get(rel)!.hash,
      ]);

      const commitObservedBatch = () => {
        for (const update of inventoryUpdates) {
          let inventory = this.externalInventory.get(update.root);
          if (!inventory) {
            inventory = new Map();
            this.externalInventory.set(update.root, inventory);
          }
          if (update.hash === null) inventory.delete(update.key);
          else
            inventory.set(update.key, { hash: update.hash, abs: update.abs });
        }
        for (const key of ownerRemovals) {
          delete this.externalFileOwners[key];
        }
      };
      let ingested: SourceIngestionResult;
      try {
        this.beginStatusAttempt();
        // Dropping a quarantined file beats aborting the batch: an aborted
        // batch writes 'idle' and leaves waiting loaders unscheduled.
        ingested = await this.corpus.prepare({
          fileCache: this.fileCache,
          externalFileOwners: this.externalFileOwners,
        });
        this.throwOnAbortedParse(ingested);
        this.skippedSources = ingested.skippedOriginals ?? [];
        this.ingestionOpenings = ingested.openings ?? [];
        if (this.systemReloadOwed) {
          this.log(
            'system reload: publishing the reload a parse hold deferred'
          );
          this.resetForHmr();
          await this.runFullPipeline(pending);
          this.systemReloadOwed = false;
          return;
        }
        this.externalFileOwners = projectExternalFileOwners(
          ingested,
          this.externalFileOwners
        );

        resetAnalysisStartedPromise(this.key);
        const promise = this.runIncrementalPipeline(
          ingested.analysisEntries,
          pending
        );
        setAnalysisStartedPromise(this.key, promise);
        await promise;
      } catch (err) {
        if (err instanceof AbortedParseRejection) {
          // An aborted parse holds publication: keep every observed source,
          // valid edits included, for the repair to publish together.
          commitObservedBatch();
        } else {
          // Roll the cache back: the failed attempt published nothing, so
          // the same content must analyze again on the next observation.
          for (const [key, prior] of priorCacheEntries) {
            if (prior === null) this.fileCache.delete(key);
            else this.fileCache.set(key, prior);
          }
          this.externalFileOwners = priorExternalFileOwners;
        }
        if (this.statusAttemptOpen) {
          this.debouncePending.clear();
          this.writeAnalysisStatus('failed', pending, String(err));
        }
        throw err;
      }
      this.publishSourceIngestion(ingested);
      commitObservedBatch();
    } else if (this.statusAttemptOpen) {
      // A debounced burst produced nothing analyzable — close the attempt so
      // no loader waits on a status that never commits. A held rejection
      // still describes the corpus, so it closes as failed.
      this.debouncePending.clear();
      if (this.heldRejection === null) this.writeAnalysisStatus('idle', []);
      else this.writeAnalysisStatus('failed', [], this.heldRejection);
    }
  }

  /** An aborted parse fails the attempt in every mode with a terminal
   *  `failed` status, so the last commit stays current, and holds publication
   *  until an attempt without one publishes. */
  private throwOnAbortedParse(prepared: SourceIngestionResult): void {
    const rejection = this.corpus.rejection(prepared);
    if (!rejection) return;
    this.heldRejection = rejection.message;
    throw new AbortedParseRejection(rejection.message);
  }

  private publishSourceIngestion(result: SourceIngestionResult): void {
    this.heldRejection = null;
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
        this.key,
        `${this.driverLabel}:${this.sessionDir}`
      );
      // The on-disk record is what stops a sibling from pruning this tree.
      // The build holds it, and releases it only when it retires.
      mkdirSync(this.sessionDir, { recursive: true });
      holdBuildClaimRecord(this.key, () =>
        holdDirectoryClaim(this.sessionDir, { build: this.sessionId })
      );
      this.releasePublicationClaim = releaseOwner;
    }

    // Ownership is decided by whether `system` is set, so a failed pass must
    // restore it — otherwise this session answers as owner with empty caches.
    const priorSystem = this.system;

    const nested = getWatchTransaction(this.key) !== null;
    // A top-level full read covers every observation queued before it, so
    // it settles them; one queued after it runs next.
    const taken = nested ? null : this.takeObservations().taken;
    const transaction = this.runPipelineTransaction(pending);
    if (taken !== null) {
      setWatchTransaction(this.key, transaction);
      this.settleTaken(taken, transaction);
    }
    try {
      await transaction;
    } catch (error) {
      // The authority stays the committed system's, with its proofs.
      this.system = priorSystem;
      throw error;
    } finally {
      if (!nested) setWatchTransaction(this.key, null);
    }
    this.commitSystemAuthority();
  }

  /** The build's authority becomes the system this session committed, with
   *  it and never before: a failed reload leaves the committed one, and the
   *  context proofs made against it. A committed reload discards every
   *  other context's proof, even for an unchanged system: the reload may
   *  have changed what another context resolves, so each loads again. */
  private commitSystemAuthority(): void {
    setSystemAuthority(this.key, {
      ...systemLoad(this.system!),
      context: this.resolutionContextText(),
      label: this.resolutionContextLabel(),
      others: new Map(),
    });
  }

  private async runPipelineTransaction(
    pending: Array<[string, string]>
  ): Promise<void> {
    const pipelineStart = this.now();
    const bt: Record<string, number> = {};

    // Hygiene first, then publish this session's artifact dir for the
    // in-process loader before any analysis can complete.
    this.runSessionStartHygiene();
    setSessionArtifactDir(this.key, this.sessionDir);

    const rootDir = this.rootDir!;
    const priorSourceState = this.snapshotSourceState();
    const resolvedSystemPath = resolve(rootDir, this.options.system);

    // One resolution context, which system loading and package resolution
    // both read: the host's conditions and extension order, and the session
    // root's declared workspaces.
    const context: SessionResolutionContext = {
      conditions: this.conditions,
      workspaces: declaredWorkspacePackages(rootDir),
      extensions: this.extensionPolicy,
    };
    this.log(`extension order: ${context.extensions.resolverVersion}`);
    let t = this.now();
    this.system = this.loadSystemUnder(context);
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
    // Once per build: its first full discovery, whether or not it publishes.
    if (claimUnmatchedExcludeReport(this.key)) {
      for (const line of unmatchedExcludeLines(excludeMatcher)) {
        console.error(line);
      }
    }

    bt.fileDiscovery = this.elapsed(t);

    // Local and external discovery establish one complete resolver index
    // before shared adaptation runs.
    t = this.now();
    const rawEntries: FileEntry[] = [];
    // Published only once collection completes, so a throw in between leaves
    // the previous generation's set in place. A configured file that cannot
    // be read is lost input, not degradation: error severity fails a strict
    // build.
    const ingestionFailures: ManifestDiagnostic[] = [];
    for (const filePath of files) {
      const relPath = relative(rootDir, filePath);
      let source: string;
      try {
        source = readFileSync(filePath, 'utf-8');
      } catch (err) {
        if (!isDeletedSource(err)) {
          ingestionFailures.push(unreadableSourceDiagnostic(relPath, err));
        }
        continue;
      }
      rawEntries.push({ path: relPath, source, hash: contentHash(source) });
    }

    bt.fileRead = this.elapsed(t);

    // Package resolution, as system loading resolves: under the same
    // context, every answer the loader's. The traversal and ingest below
    // are the shared collector.
    t = this.now();
    const packageResolution: PackageResolution = {
      resolveSpecifier: (
        specifier,
        fromDir,
        { conditions, workspaces, extensions }
      ) => {
        const native = engineApi(this.key).resolveSpecifier;
        if (native === undefined) {
          throw new Error(
            'the native engine does not expose resolveSpecifier, which package resolution needs — rebuild @animus-ui/extract'
          );
        }
        return native(
          specifier,
          fromDir,
          [...conditions],
          workspaces,
          extensionPolicyJson(extensions)
        );
      },
    };
    const discoveryDiagnostics: ManifestDiagnostic[] = [];
    const packageNames = await extractSystemFilePackages(
      resolvedSystemPath,
      engineModuleParser(engineApi(this.key)),
      (diagnostic) => discoveryDiagnostics.push(diagnostic),
      (name) => {
        const entry = resolvePackagesByName(
          rootDir,
          [name],
          packageResolution,
          context
        ).entries[name];
        return entry ? resolve(rootDir, entry) : null;
      },
      context.extensions
    );
    discoveryDiagnostics.push(
      ...importedKitDiagnostics(
        rawEntries,
        engineApi(this.key),
        rootDir,
        packageNames
      )
    );
    const preResolved = resolvePackagesByName(
      rootDir,
      packageNames,
      packageResolution,
      context
    );

    // Raw content hashes of every walked external file, keyed by absolute
    // path — recorded before MDX preprocessing so the diff sees raw bytes.
    const rawExternalFiles = new Map<string, string>();

    const collected = await collectExternalPackageSources({
      extensions: context.extensions,
      kitSourceRoot: nativeKitSourceRoot(
        engineApi(this.key),
        rootDir,
        context.conditions,
        context.workspaces,
        extensionPolicyJson(context.extensions)
      ),
      specifiers: packageNames,
      resolveSpecifier: (name) =>
        preResolved.entries[name]
          ? resolve(rootDir, preResolved.entries[name])
          : null,
      unresolvedReason: (name) => preResolved.unresolved[name],
      rootDir,
      extensionsSet,
      hasEntry: (relPath) => rawEntries.some((e) => e.path === relPath),
      hostOutputDirs: this.structuralExclude.map((dir) =>
        resolve(rootDir, dir)
      ),
      onSourceRead: (source, _relPath, absPath) => {
        rawExternalFiles.set(absPath, contentHash(source));
      },
      onUnreadable: (relPath, err) => {
        if (!isDeletedSource(err)) {
          ingestionFailures.push(unreadableSourceDiagnostic(relPath, err));
        }
      },
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

    surfaceManifestDiagnostics(
      {
        diagnostics: [...discoveryDiagnostics, ...collected.diagnostics],
      },
      (message) => this.warn(message),
      // An error-severity discovery diagnostic fails a strict build.
      {
        levels: this.options.diagnostics,
        strict: this.options.strict,
        reportErrors: this.reportErrors(),
      }
    );
    const unresolvableMessage = unresolvableIncludesMessage(
      collected.outcomes,
      relative(rootDir, resolvedSystemPath)
    );
    if (unresolvableMessage !== null) {
      if (this.options.strict) this.strictFailure(unresolvableMessage);
      else this.warn(unresolvableMessage);
    }
    // A stale dist entry rides the same strict/warn seam: merging against it
    // skews registry content away from the discovered sources.
    const staleDistMessage = staleDistIncludesMessage(collected.outcomes);
    if (staleDistMessage !== null) {
      if (this.options.strict) this.strictFailure(staleDistMessage);
      else this.warn(staleDistMessage);
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
      // Strict development reports it on each full pipeline instead.
      if (this.options.strict) {
        this.strictFailure(`[${this.driverLabel}] ${message}`);
      } else {
        this.stickyDiagnostics.set('cross-volume', message);
      }
    }
    for (const message of this.stickyDiagnostics.values()) {
      this.warn(message);
    }
    const admitted = excludeCollectedPackages(
      collected,
      rejectedSpecifiers,
      rootDir
    );
    this.kitDescriptors = admitted.kitDescriptors;

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
      this.externalSourceSideEffects = admitted.sourceEntrySideEffects;
      for (const entry of admitted.entries) {
        const hash = contentHash(entry.source);
        rawEntries.push({ path: entry.path, source: entry.source, hash });
      }

      this.externalPackageDirs = admitted.packageDirs;
      this.externalLinkedDirs = admitted.linkedDirs;
      this.externalOutputDirs = admitted.outputDirs;

      bt.packageResolve = this.elapsed(t);

      this.beginStatusAttempt();
      let accepted: SourceIngestionResult;
      try {
        accepted = await this.corpus.prepare(
          this.withoutOutputSources(rawEntries)
        );
        this.throwOnAbortedParse(accepted);
        this.skippedSources = accepted.skippedOriginals ?? [];
        this.ingestionOpenings = accepted.openings ?? [];
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
      clearEngineCache(() => engineApi(this.key));
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
      setSharedExternalDirs(this.key, admitted.packageDirs);
      setSharedExternalEntries(this.key, admitted.sourceEntries);
      setSharedExternalSideEffects(this.key, admitted.sourceEntrySideEffects);

      this.onExternalRootsCommitted?.(this.externalWatchRoots);

      // Registered only on SUCCESS: a failed pipeline leaves no owner that
      // would accept batches it cannot analyze.
      setOwningWatchSession(this.key, this);
    } catch (err) {
      this.restoreSourceState(priorSourceState);
      throw err;
    }
  }

  /** Per-generation source state captured as ONE object so the restore
   *  cannot omit a member; deep-copied fields are mutated in place. */
  /** The full pass's analysis inputs, less any file whose real path lies in
   *  an output directory, each reported. */
  private withoutOutputSources(entries: FileEntry[]): FileEntry[] {
    const inOutput = outputSourceGuard(this.rootDir!, this.structuralExclude);
    return entries.filter((entry) => {
      const outputDir = inOutput(resolve(this.rootDir!, entry.path));
      if (outputDir === null) return true;
      this.warn(outputSourceMessage(entry.path, outputDir));
      return false;
    });
  }

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
      externalSourceSideEffects: this.externalSourceSideEffects,
      externalPackageDirs: this.externalPackageDirs,
      ingestionFailureDiagnostics: this.ingestionFailureDiagnostics,
    };
  }

  private restoreSourceState(
    snapshot: ReturnType<ExtractionSession['snapshotSourceState']>
  ): void {
    Object.assign(this, snapshot);
  }

  /** The system under `context`: the one load path for the build's
   *  authority and for a participant checking its own context. */
  private loadSystemUnder(context: SessionResolutionContext): SystemConfig {
    return loadSystemConfig(() => engineApi(this.key), {
      systemPath: resolve(this.rootDir!, this.options.system),
      rootDir: this.rootDir!,
      prefix: this.options.prefix,
      prefixContextualVars: this.options.prefixContextualVars,
      conditions: context.conditions,
      workspaces: context.workspaces,
      extensions: context.extensions,
    });
  }

  /** What the system loader reads of this participant besides the root, as
   *  stable text: its conditions and extension order. */
  private resolutionContextText(): string {
    return JSON.stringify([
      this.conditions,
      extensionPolicyJson(this.extensionPolicy),
    ]);
  }

  private resolutionContextLabel(): string {
    return (
      `${this.driverLabel} with conditions [${this.conditions.join(', ')}] ` +
      `and extension order ${this.extensionPolicy.resolverVersion}`
    );
  }

  /** One agreed system authority (SA5): a participant whose resolution
   *  context differs from the one the build's system was loaded under loads
   *  it once under its own, and proceeds only on the same system. Otherwise
   *  it throws, naming both contexts, whichever participant came first. */
  agreeWithSystemAuthority(): void {
    const authority = getSystemAuthority(this.key);
    if (authority === null) return;
    const context = this.resolutionContextText();
    if (context === authority.context) return;
    let own = authority.others.get(context);
    if (own === undefined) {
      own = systemLoad(
        this.loadSystemUnder({
          conditions: this.conditions,
          workspaces: declaredWorkspacePackages(this.rootDir!),
          extensions: this.extensionPolicy,
        })
      );
      authority.others.set(context, own);
    }
    if (own.identity === authority.identity) return;
    const shared = new Set(authority.dependencies);
    const mine = new Set(own.dependencies);
    const differing = [
      ...authority.dependencies.filter((path) => !mine.has(path)),
      ...own.dependencies.filter((path) => !shared.has(path)),
    ].map((path) => relative(this.rootDir!, path));
    throw new SessionConfigurationConflict(
      this.key,
      authority.label,
      this.resolutionContextLabel(),
      differing.length > 0
        ? [`system modules ${differing.join(', ')}`]
        : ['the evaluated system'],
      'Every participant of one build must evaluate the same system: give ' +
        'each compiler conditions that select the same system modules.'
    );
  }

  /** Release this session's publication claim so a successor may publish,
   *  and leave the build, which retires with its last participant.
   *  Idempotent; `reattach` joins the build again. */
  close(): void {
    this.releasePublicationClaim?.();
    this.releasePublicationClaim = null;
    if (this.joinedKey === null || this.participant === null) return;
    // Another participant takes over the build's analysis, never this one.
    if (getOwningWatchSession(this.joinedKey) === this) {
      setOwningWatchSession(this.joinedKey, null);
    }
    leaveSession(this.joinedKey, this.participant);
    this.participant = null;
    // The key stays pinned: an attempt in flight finishes under it and never
    // joins the build again. Only `reattach` joins again.
    this.detached = true;
  }

  /** A closed participant attaching again: its private analysis is stale,
   *  so it is discarded, and it joins its build again. Idempotent. */
  reattach(): void {
    if (!this.detached) return;
    this.detached = false;
    this.system = null;
    this.joinedKey = null;
  }

  /** Brings a reattached participant up to date with a full rescan of a
   *  live build, which reconciles deletions too; true then. A retired build
   *  is false: the host starts it as at first. */
  async catchUp(): Promise<boolean> {
    if (getManifestJson(this.key) === null) return false;
    // One full-rescan observation, awaited like any other: the queue joins
    // an attempt in flight, routes to the current publisher, or takes over.
    await this.awaitObservation(this.recordRescan());
    return true;
  }

  /** Queues a full rescan under a new revision. It is never equivalent to
   *  an active attempt: only a full read covers it. */
  private recordRescan(): number {
    const queue = observationQueue(this.key);
    queue.rescan = true;
    const revision = ++queue.revision;
    queue.revisions.set(revision, null);
    return revision;
  }

  /** Reset analysis state for a system reload: write guards go back to null
   *  and reseed from the disk envelopes on the next publication. */
  resetForHmr(): void {
    resetAnalysisStartedPromise(this.key);
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
        // A file read again after a failed read re-queues even unchanged,
        // so the read clears its report.
        if (
          previous.get(resolved.sourceKey)?.hash !== rawHash ||
          this.ingestionFailureDiagnostics.some(
            (diagnostic) => diagnostic.file === resolved.sourceKey
          )
        ) {
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
      rootDir: this.rootDir!,
      devMode: this.engineDevMode(devMode),
      // A skipped or unreadable file may render any option, so nothing is
      // pruned while one is.
      analysisContext: {
        skippedSources: [
          ...this.skippedSources,
          ...this.ingestionFailureDiagnostics.map((d) => d.file),
        ].map((file) =>
          isAbsolute(file) ? relative(this.rootDir!, file) : file
        ),
        unbundledComputedImports: this.host.unbundledComputedImports,
        openings: [...this.ingestionOpenings],
        packageDirs: this.externalPackageDirs.map((dir) =>
          relative(this.rootDir!, dir)
        ),
        linkedDirs: this.externalLinkedDirs.map((dir) =>
          relative(this.rootDir!, dir)
        ),
        outputDirs: this.externalOutputDirs.map((dir) =>
          relative(this.rootDir!, dir)
        ),
        extensions: this.extensionPolicy,
      },
    };

    this.writeAnalysisStatus('analyzing', pending);
    // An error-level diagnostic, a hard error included, throws here in a
    // build, before any stylesheet is assembled: no partial generation.
    const result = runProjectAnalysis(() => engineApi(this.key), {
      ...analysisOptions,
      warn: (message) => this.warn(message),
      info: (message) => this.log(message),
      strict: this.options.strict,
      diagnostics: this.options.diagnostics,
      reportErrors: this.reportErrors(),
      extraDiagnostics: this.ingestionFailureDiagnostics,
      kitDescriptors: this.kitDescriptors,
    });

    enforceExternalTokenContracts({
      diagnostics: result.manifest?.diagnostics,
      fileOwners: this.externalFileOwners,
      dirOwners: this.externalDirOwners,
      sourceThemeManifestsJson: system.sourceThemeManifestsJson,
      strict: this.options.strict,
      prefix: `[${this.driverLabel}]`,
      warn: (message: string) => this.warn(message),
      reportErrors: this.reportErrors(),
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
    const sheets = this.substituteAssetReferences(
      {
        variableCss: system.variableCss,
        globalCss: result.globalCss,
        componentCss: result.componentCss,
      },
      !devMode || this.staleAssetPruning === 'every-cycle'
    );

    const { declaration, variables, body } = assembleStylesheet({
      layers: this.options.layers,
      ...sheets,
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
      minify: this.options.minify ?? this.startupMode === 'production',
      targets: this.lcssTargets,
      warnFn: (msg) => this.warn(msg),
    });

    const fullCss = [declaration, variables, processedBody]
      .filter(Boolean)
      .join('\n');
    reportSurvivingAssetPlaceholders(fullCss, {
      strict: this.options.strict,
      warn: (message) => this.warn(message),
      reportErrors: this.reportErrors(),
      prefix: `[${this.driverLabel}]`,
    });
    reportSurvivingAssetPlaceholders(generatedModuleCode(manifest), {
      strict: this.options.strict,
      warn: (message) => this.warn(message),
      reportErrors: this.reportErrors(),
      prefix: `[${this.driverLabel}]`,
      surface: 'generated runtime modules',
    });

    setSharedCss(this.key, fullCss);

    const systemPropsContent = buildSystemPropsModule({
      systemPropMapJson: JSON.stringify(manifest?.system_prop_map ?? {}),
      groupRegistryJson: system.groupRegistryJson,
      dynamicProps: manifest?.dynamic_props ?? {},
      admittedTransforms: manifest?.admitted_transforms ?? {},
      typedSystemProps: manifest?.typed_system_props ?? [],
    });

    setSharedSystemProps(this.key, systemPropsContent);

    setManifestJson(this.key, result.manifestJson);

    // The analyzed-hash map publishes with the manifest — one generation,
    // one publication; it is the loader's stale-input witness.
    setAnalyzedHashes(
      this.key,
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
    setReplacementEpoch(this.key, epoch);
  }

  /** sessions-root listing memo, keyed by the root dir's mtime — a new or
   *  pruned sibling DIRECTORY moves it; agreeing siblings stay listed. */
  private siblingListing: { mtimeMs: number; entries: string[] } | null = null;

  /** Restored-module snapshots point at the epoch artifact of the session
   *  that built them, so a moved epoch deletes every DISAGREEING sibling
   *  artifact to invalidate them. Agreeing siblings stay byte-untouched so
   *  warm restores keep working; a sibling with a live owner is exempt. */
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
   *  A tree whose build is registered in this process is ours and live,
   *  claim or no claim: a publisher's close() releases the claim while the
   *  build's other participants still serve from it. Otherwise a missing,
   *  undecodable or unreadable claim, or one naming our own pid, means no
   *  owner: the opposite default from the CLI lock check on purpose, so do
   *  not unify the two. */
  private liveSiblingOwnerPid(siblingDir: string): number | null {
    // A session directory is named by its build.
    const build = basename(siblingDir);
    if (findSession(sessionKey(build, this.rootDir!)) !== undefined) {
      return process.pid;
    }
    let claim: ReturnType<typeof readCliLockRecord>;
    try {
      claim = readCliLockRecord(siblingDir);
    } catch {
      // An unreadable claim (EACCES, a raced-away tree) is not a live one.
      return null;
    }
    if (claim.kind !== 'held') return null;
    // Our own pid on an unregistered build is a tree this process left.
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

  /** Copy each asset() specifier's bytes, from every sheet, into `assets/`
   *  under a content-hashed name and substitute a url relative to
   *  styles.css. */
  private substituteAssetReferences(
    sheets: AssetSheets,
    pruneSuperseded: boolean
  ): AssetSheets {
    const specifiers = findSheetAssetSpecifiers(sheets);
    const assetsDir = join(this.sessionDir, SESSION_ASSETS_DIR);
    const expected = new Set<string>();
    this.assetDependencyPaths.clear();
    this.assetDependencyKeys.clear();

    const urlBySpecifier = new Map<string, string>();
    for (const specifier of specifiers) {
      // The memo saves resolution and the copy, never the hash: bytes can
      // change with mtime and size unchanged (SE-5). A missing copy
      // (concurrent prune) falls through and self-heals.
      const cached = this.assetCopyCache.get(specifier);
      if (cached && existsSync(join(assetsDir, cached.fileName))) {
        try {
          if (contentHash(readFileSync(cached.sourcePath)) === cached.digest) {
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
        if (this.options.strict) {
          this.strictFailure(`[${this.driverLabel}] ${message}`);
        } else {
          this.warn(message);
        }
        urlBySpecifier.set(specifier, specifier);
        continue;
      }
      const bytes = readFileSync(resolvedPath);
      const digest = contentHash(bytes);
      this.trackAssetDependency(resolvedPath);
      const ext = extname(resolvedPath);
      const stem = basename(resolvedPath, ext);
      const fileName = `${stem}.${digest.slice(0, 8)}${ext}`;
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
        digest,
        fileName,
        url,
      });
    }

    // Runs AFTER the writes so the current set is always on disk: copies are
    // content-hashed and never overwritten, so superseded ones accumulate.
    if (pruneSuperseded) pruneStaleAssets(assetsDir, expected);

    return substituteSheetAssets(sheets, urlBySpecifier);
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
