import { randomUUID } from 'crypto';
import { realpathSync } from 'fs';
import { resolve } from 'path';

import { createV2EngineApi, stableStringify } from '../pipeline/index';

import type { PackageReadRecord } from '../pipeline/alias-agreement';
import type { AnimusCoreOptions } from '../pipeline/core-options';
import type { EngineApi, V2ExtractEngine } from '../pipeline/index';

/**
 * A build's shared state lives in one registry on `globalThis`, keyed by its
 * `SessionKey`, so the ESM plugin copy and the CJS webpack-loader copy of
 * this module find the same entry, and two builds of one root never share
 * one. A reader of a build no participant has joined gets the empty value;
 * a writer must have joined it.
 */
function joined(key: SessionKey): SessionState {
  const state = findSession(key);
  if (state === undefined) {
    throw new Error(
      `[animus] no participant has joined build ${key.build} of ${key.root}`
    );
  }
  return state;
}

export function getManifestJson(key: SessionKey): string | null {
  return findSession(key)?.manifestJson ?? null;
}

export function setManifestJson(key: SessionKey, json: string): void {
  joined(key).manifestJson = json;
}

/**
 * A latch over the most recently STARTED analysis, never cleared on settle:
 * non-null means one was scheduled. In-flight lives in getWatchTransaction.
 */
export function getAnalysisStartedPromise(
  key: SessionKey
): Promise<void> | null {
  return findSession(key)?.analysisStarted ?? null;
}

export function setAnalysisStartedPromise(
  key: SessionKey,
  promise: Promise<void>
): void {
  joined(key).analysisStarted = promise;
}

export function resetAnalysisStartedPromise(key: SessionKey): void {
  const state = findSession(key);
  if (state !== undefined) state.analysisStarted = null;
}

/** True for the build's first caller only: the one that reports its
 *  unmatched user excludes. */
export function claimUnmatchedExcludeReport(key: SessionKey): boolean {
  const state = joined(key);
  if (state.unmatchedExcludesReported) return false;
  state.unmatchedExcludesReported = true;
  return true;
}

export function getSharedCss(key: SessionKey): string {
  return findSession(key)?.sharedCss ?? '';
}

export function setSharedCss(key: SessionKey, css: string): void {
  joined(key).sharedCss = css;
}

export function getSharedSystemProps(key: SessionKey): string {
  return findSession(key)?.sharedSystemProps ?? '';
}

export function setSharedSystemProps(key: SessionKey, content: string): void {
  joined(key).sharedSystemProps = content;
}

export function getSharedExternalDirs(key: SessionKey): string[] {
  return findSession(key)?.externalDirs ?? [];
}

export function setSharedExternalDirs(key: SessionKey, dirs: string[]): void {
  joined(key).externalDirs = dirs;
}

export function getSharedExternalEntries(key: SessionKey): Map<string, string> {
  return findSession(key)?.externalEntries ?? new Map();
}

export function setSharedExternalEntries(
  key: SessionKey,
  entries: Map<string, string>
): void {
  joined(key).externalEntries = entries;
}

/** Specifier → its source entry's side effects, published with the shared
 *  entries; absent leaves the bundler's own classification. */
export function getSharedExternalSideEffects(
  key: SessionKey
): Map<string, boolean> {
  return findSession(key)?.externalSideEffects ?? new Map();
}

export function setSharedExternalSideEffects(
  key: SessionKey,
  sideEffects: Map<string, boolean>
): void {
  joined(key).externalSideEffects = sideEffects;
}

/** Structural view of the target session, declared here rather than imported
 *  so the singleton never depends on the session module it serves. */
export interface WatchBatchTarget {
  /** Starts one attempt over the build's untaken observations; false when
   *  this session cannot analyze. */
  startObservedAttempt(): boolean;
}

/**
 * The only session of a build that can run watch analysis. A non-owning
 * session's observations queue for it; dropping them loses files only that
 * watcher sees.
 */
export function getOwningWatchSession(
  key: SessionKey
): WatchBatchTarget | null {
  return findSession(key)?.authority ?? null;
}

export function setOwningWatchSession(
  key: SessionKey,
  session: WatchBatchTarget | null
): void {
  joined(key).authority = session;
}

/**
 * Per-file content hashes of the last published analysis (relPath → hash of
 * the exact bytes analyzed), including files that produced zero entries.
 */
export function getAnalyzedHashes(
  key: SessionKey
): ReadonlyMap<string, string> | null {
  return findSession(key)?.analyzedHashes ?? null;
}

export function setAnalyzedHashes(
  key: SessionKey,
  hashes: Map<string, string>
): void {
  joined(key).analyzedHashes = hashes;
}

/** What the build's last published analysis read of the discovered
 *  packages (spec §2.2 A4); null before one publishes. */
export function getSharedPackageReadRecord(
  key: SessionKey
): PackageReadRecord | null {
  return findSession(key)?.packageReadRecord ?? null;
}

export function setSharedPackageReadRecord(
  key: SessionKey,
  record: PackageReadRecord
): void {
  joined(key).packageReadRecord = record;
}

/**
 * One participant publishes a build's analysis, holding this claim until it
 * closes: a second publisher would clobber its artifacts. Two builds never
 * exclude each other; sequential claim and release cycles are legal.
 */
export function claimExclusiveSessionOwner(
  key: SessionKey,
  label: string
): () => void {
  const state = joined(key);
  const active = state.activeAttempt;
  if (active !== null) {
    throw new Error(
      `[animus] "${label}" started an analysis of build ${key.build} of ${key.root}, ` +
        `which "${active}" publishes. A build's participants share one analysis; run it ` +
        `once and let the others read its results.`
    );
  }
  state.activeAttempt = label;
  return () => {
    if (state.activeAttempt === label) state.activeAttempt = null;
  };
}

/**
 * Absolute artifact directory of the build's last publication. The
 * Turbopack loader runs out of process and receives it via options instead.
 */
export function getSessionArtifactDir(key: SessionKey): string | null {
  return findSession(key)?.artifactDir ?? null;
}

export function setSessionArtifactDir(key: SessionKey, dir: string): void {
  joined(key).artifactDir = dir;
}

/**
 * Replacement epoch of the last published analysis, written AFTER the
 * manifest so an epoch reader always sees at least that generation's manifest.
 */
export function getReplacementEpoch(key: SessionKey): string | null {
  return findSession(key)?.replacementEpoch ?? null;
}

export function setReplacementEpoch(key: SessionKey, epoch: string): void {
  joined(key).replacementEpoch = epoch;
}

/**
 * The build's one in-flight watch-analysis transaction: a participant that
 * did not start it joins this promise rather than read a pre-transaction
 * generation.
 */
export function getWatchTransaction(key: SessionKey): Promise<void> | null {
  return findSession(key)?.watchTransaction ?? null;
}

/**
 * The build's watch observations, recorded before any await so an attempt
 * that rejects never erases one it did not take (SA20). An observation's
 * state is its content hash, `removed` or `unreadable`.
 */
export interface ObservationQueue {
  /** The latest revision handed to a recording caller. */
  revision: number;
  /** A full rescan is requested: the attempt that takes it reads every
   *  file, so deletions nobody reported reconcile too. */
  rescan: boolean;
  /** Each path no attempt has taken yet, with its latest state. */
  readonly untaken: Map<string, string>;
  /** The bytes a host supplied for an untaken path's latest observation,
   *  which the attempt that takes it reads in place of the disk. */
  readonly suppliedSources: Map<string, string>;
  /** Each waiting caller's revision, and the attempt that took it once one
   *  has. */
  readonly revisions: Map<number, Promise<void> | null>;
  /** The active attempt and the states it took: an equivalent observation
   *  joins it rather than run again. */
  active: {
    readonly taken: ReadonlyMap<string, string>;
    readonly transaction: Promise<void>;
  } | null;
}

export function observationQueue(key: SessionKey): ObservationQueue {
  return joined(key).observations;
}

/** A system as one resolution context loaded it: the evaluated modules and
 *  a fingerprint of everything the load produced. */
export interface SystemLoad {
  readonly identity: string;
  readonly dependencies: readonly string[];
}

/**
 * The build's one agreed system (SA5): the load its analysis runs on, the
 * resolution context that made it, and each other participant context's
 * load of the same system, made once.
 */
export interface SystemAuthority extends SystemLoad {
  /** The context as stable text, and as a conflict names it. */
  readonly context: string;
  readonly label: string;
  readonly others: Map<string, SystemLoad>;
}

export function getSystemAuthority(key: SessionKey): SystemAuthority | null {
  return findSession(key)?.systemAuthority ?? null;
}

export function setSystemAuthority(
  key: SessionKey,
  authority: SystemAuthority
): void {
  joined(key).systemAuthority = authority;
}

export function setWatchTransaction(
  key: SessionKey,
  transaction: Promise<void> | null
): void {
  joined(key).watchTransaction = transaction;
}

/** Single choke-point for every native extraction call; the NAPI module's
 *  own `.d.ts` is the authoritative surface for what it returns. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function requireEngine(): any {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@animus-ui/extract');
}

const ENGINE_API_OVERRIDE_KEY = '__animus_engine_api_override__';

// SAFETY: this module is the sole owner of this fixed globalThis key, which
// holds only the engine-API test seam.
const overrideGlobal = globalThis as typeof globalThis & {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [ENGINE_API_OVERRIDE_KEY]?: () => any;
};

/**
 * Test seam, set once at module top level: it lives outside the session
 * registry so a per-test reset cannot strip the override.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function setEngineApiOverride(api: (() => any) | null): void {
  overrideGlobal[ENGINE_API_OVERRIDE_KEY] = api ?? undefined;
}

/** The native engine module could not be loaded: an environment failure,
 *  never answered by another engine. */
export class EnvironmentFailure extends Error {
  readonly code = 'EnvironmentFailure';

  constructor(cause: Error | string) {
    super(
      `[animus] EnvironmentFailure: the native extraction engine could not be loaded: ${String(cause)}`,
      { cause }
    );
    this.name = 'EnvironmentFailure';
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let loadEngineFactory: () => any = requireEngine;

/** Test seam: the loader of the native factory; null restores the real one. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function setEngineFactoryLoaderForTests(load: (() => any) | null): void {
  loadEngineFactory = load ?? requireEngine;
}

/** The native factory, loaded once for every build in the process. A load
 *  failure is an EnvironmentFailure, and is not cached: the next use tries
 *  the load again. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function engineFactory(): any {
  const registry = sessionRegistry();
  if (registry.factory === null) {
    try {
      registry.factory = loadEngineFactory();
    } catch (error) {
      throw new EnvironmentFailure(
        error instanceof Error ? error : String(error)
      );
    }
  }
  return registry.factory;
}

/** How a host's engine API reads: its log label, and the host-specific
 *  adapter options. */
export interface EngineHandleOptions {
  label: string;
  passThroughUnknownPaths?: boolean;
  rehydrateFilesJson?(filesJsonRaw: string): string;
}

/**
 * One engine-handle store (SA18): the engine API over `key`'s own engine
 * state, made once per key in the registry every module copy joins. The
 * native factory is shared; each key's engine instance, analyze-time
 * sources and drift flag are its own, and its build's retirement releases
 * them. A key need not be a joined build's: a Vite context or a Turbopack
 * worker keys its own.
 */
export function engineHandle(
  key: SessionKey,
  options: EngineHandleOptions
): () => EngineApi {
  const engines = sessionRegistry().engines;
  const id = sessionKeyId(key);
  let api = engines.get(id);
  if (api === undefined) {
    let engine: V2ExtractEngine | null = null;
    let sentSources: Map<string, string> | null = null;
    let driftWarned = false;
    api = createV2EngineApi({
      ...options,
      isV2: () => true,
      loadNativeEngine: engineFactory,
      store: {
        getEngine: () => engine,
        setEngine: (next) => {
          engine = next;
        },
        getSentSources: () => sentSources,
        setSentSources: (sources) => {
          sentSources = sources;
        },
        getDriftWarned: () => driftWarned,
        setDriftWarned: (value) => {
          driftWarned = value;
        },
      },
    });
    engines.set(id, api);
  }
  return api;
}

/** Releases a standalone handle, one no joined build retires: its host
 *  calls this when it closes. */
export function releaseEngineHandle(key: SessionKey): void {
  sessionRegistry().engines.delete(sessionKeyId(key));
}

/**
 * The build's engine API, from the one engine-handle store.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function engineApi(key: SessionKey): any {
  const override = overrideGlobal[ENGINE_API_OVERRIDE_KEY];
  if (override) return override();
  joined(key);
  // Driver-neutral: every participant of the build reaches this one
  // instance, so a host-branded label misattributes drift warnings.
  return engineHandle(key, {
    label: 'animus',
    passThroughUnknownPaths: true,
  })();
}

/** The participant protocol a `SessionKey` was made under; a participant
 *  from a copy speaking another version never joins its session. */
export const SESSION_PROTOCOL = 1;

/**
 * One host build of one root. The owning host wrapper creates the build id
 * and passes the key to every participant and worker, so two concurrent
 * builds of one root stay distinct.
 */
export interface SessionKey {
  readonly build: string;
  readonly root: string;
  readonly protocol: number;
}

/** A fresh build id, created once by the owning host wrapper. */
export function createBuildId(): string {
  return randomUUID();
}

/** The key of build `build` of `root`, by the root's canonical path. */
export function sessionKey(build: string, root: string): SessionKey {
  const absolute = resolve(root);
  let canonical = absolute;
  try {
    canonical = realpathSync(absolute);
  } catch {
    // A root that does not exist yet keeps its absolute spelling.
  }
  return { build, root: canonical, protocol: SESSION_PROTOCOL };
}

function sessionKeyId(key: SessionKey): string {
  return JSON.stringify([key.protocol, key.build, key.root]);
}

/** A participant joined a session with semantic options that differ from
 *  those the session was created with. */
export class SessionConfigurationConflict extends Error {
  readonly code = 'SessionConfigurationConflict';

  constructor(
    readonly key: SessionKey,
    readonly established: string,
    readonly joining: string,
    readonly differing: readonly string[],
    requirement = 'Every participant of one build must use the same Animus options.'
  ) {
    super(
      `[animus] SessionConfigurationConflict: "${joining}" joined build ` +
        `${key.build} of ${key.root} with ${differing.join(', ')} differing ` +
        `from "${established}". ${requirement}`
    );
    this.name = 'SessionConfigurationConflict';
  }
}

/** How one option reads as stable text: the field it reads, which the
 *  classification below checks against its key. */
interface OptionDigest<Key extends keyof AnimusCoreOptions> {
  readonly field: Key;
  text(options: AnimusCoreOptions): string | undefined;
}

function digestOf<Key extends keyof AnimusCoreOptions>(
  field: Key
): OptionDigest<Key> {
  return {
    field,
    text: (options) => {
      const value = options[field];
      return value === undefined ? undefined : stableStringify(value);
    },
  };
}

/**
 * Every option, classified: one a build's analysis depends on, which every
 * participant must agree on, or one deliberately excluded. `verbose` changes
 * no output, and the root is the key's. The type checker rejects an option
 * added to `AnimusCoreOptions` until it is classified here.
 */
const OPTION_CLASSES = {
  system: digestOf('system'),
  exclude: digestOf('exclude'),
  extensions: digestOf('extensions'),
  strict: digestOf('strict'),
  diagnostics: digestOf('diagnostics'),
  verbose: 'excluded',
  prefix: digestOf('prefix'),
  prefixContextualVars: digestOf('prefixContextualVars'),
  targets: digestOf('targets'),
  minify: digestOf('minify'),
  staticCss: digestOf('staticCss'),
  layers: digestOf('layers'),
  engine: digestOf('engine'),
  mode: digestOf('mode'),
  root: 'excluded',
} as const satisfies {
  [Key in keyof AnimusCoreOptions]-?: OptionDigest<Key> | 'excluded';
};

/** The options a build's analysis depends on, each as stable text; each is
 *  data by its type, so equal text is an equal value. A host's own options
 *  are not the build's. */
function semanticOptions(options: AnimusCoreOptions): Map<string, string> {
  const present: Array<[string, string]> = [];
  for (const [name, digest] of Object.entries(OPTION_CLASSES)) {
    if (digest === 'excluded') continue;
    const text = digest.text(options);
    if (text !== undefined) present.push([name, text]);
  }
  return new Map(present);
}

/** The mutable state of one session, which every participant shares. */
export interface SessionState {
  readonly key: SessionKey;
  /** The first participant, whose options the session was created with. */
  readonly established: string;
  readonly options: ReadonlyMap<string, string>;
  readonly participants: Set<string>;
  /** The participant that publishes the build's analysis: one per build. */
  activeAttempt: string | null;
  /** The session that runs this build's analysis; others join its results
   *  and forward their watch batches to it. */
  authority: WatchBatchTarget | null;
  /** A latch over the most recently started analysis, never cleared on
   *  settle: non-null means one was scheduled. */
  analysisStarted: Promise<void> | null;
  /** The one in-flight watch-analysis transaction. */
  watchTransaction: Promise<void> | null;
  observations: ObservationQueue;
  systemAuthority: SystemAuthority | null;
  /** Releases the build's on-disk claim record; null until one is held. */
  claimRecord: (() => void) | null;
  manifestJson: string | null;
  sharedCss: string;
  sharedSystemProps: string;
  externalDirs: string[];
  externalEntries: Map<string, string>;
  /** Specifier → its source entry's side effects; absent leaves the
   *  bundler's own classification. */
  externalSideEffects: Map<string, boolean>;
  /** Root-relative path → hash of the bytes the last published analysis
   *  read, including files that produced no entries. */
  analyzedHashes: Map<string, string> | null;
  /** What the last published analysis read of the discovered packages,
   *  which every participant checks its host's answers against. */
  packageReadRecord: PackageReadRecord | null;
  /** Written after the manifest, so a reader of the epoch sees at least
   *  that generation's manifest. */
  replacementEpoch: string | null;
  /** The artifact directory of the session's last publication. */
  artifactDir: string | null;
  /** Whether the build reported its unmatched user excludes: once, after
   *  its first full discovery, whether or not that pass publishes. */
  unmatchedExcludesReported: boolean;
}

const SESSION_REGISTRY = Symbol.for('animus.session-registry.v1');

interface SessionRegistry {
  readonly sessions: Map<string, SessionState>;
  /** The one engine-handle store: each key's engine API. */
  readonly engines: Map<string, () => EngineApi>;
  /** The native factory, once loaded. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  factory: any;
}

// SAFETY: the symbol is this module's own, and every copy of this module,
// ESM or CJS, writes it only through this function.
const registryGlobal = globalThis as typeof globalThis & {
  [SESSION_REGISTRY]?: SessionRegistry;
};

function sessionRegistry(): SessionRegistry {
  return (registryGlobal[SESSION_REGISTRY] ??= {
    sessions: new Map(),
    engines: new Map(),
    factory: null,
  });
}

/**
 * Joins `participant` to the session of `key`, creating it with `options` on
 * the first join. A later participant must bring the same semantic options.
 */
export function joinSession(
  key: SessionKey,
  participant: string,
  options: AnimusCoreOptions
): SessionState {
  const sessions = sessionRegistry().sessions;
  const id = sessionKeyId(key);
  const joining = semanticOptions(options);
  const existing = sessions.get(id);
  if (existing === undefined) {
    const state: SessionState = {
      key,
      established: participant,
      options: joining,
      participants: new Set([participant]),
      activeAttempt: null,
      authority: null,
      analysisStarted: null,
      watchTransaction: null,
      observations: {
        revision: 0,
        rescan: false,
        untaken: new Map(),
        suppliedSources: new Map(),
        revisions: new Map(),
        active: null,
      },
      systemAuthority: null,
      claimRecord: null,
      manifestJson: null,
      sharedCss: '',
      sharedSystemProps: '',
      externalDirs: [],
      externalEntries: new Map(),
      externalSideEffects: new Map(),
      analyzedHashes: null,
      packageReadRecord: null,
      replacementEpoch: null,
      artifactDir: null,
      unmatchedExcludesReported: false,
    };
    sessions.set(id, state);
    return state;
  }
  const names = new Set([...existing.options.keys(), ...joining.keys()]);
  const differing = [...names].filter(
    (name) => existing.options.get(name) !== joining.get(name)
  );
  if (differing.length > 0) {
    throw new SessionConfigurationConflict(
      key,
      existing.established,
      participant,
      differing.sort()
    );
  }
  existing.participants.add(participant);
  return existing;
}

/** The session of `key`, if a participant has joined it. */
export function findSession(key: SessionKey): SessionState | undefined {
  return sessionRegistry().sessions.get(sessionKeyId(key));
}

/** The build's on-disk claim record, which stops another process pruning
 *  its tree: held once by the build, whichever participant publishes, and
 *  released only when the build retires. */
export function holdBuildClaimRecord(
  key: SessionKey,
  hold: () => () => void
): void {
  const state = joined(key);
  state.claimRecord ??= hold();
}

/** `participant` leaves the build of `key`. The build retires with its
 *  last participant, once no attempt is in flight: it leaves the registry
 *  and releases its claim record, so its tree is pruned once stale. */
export function leaveSession(key: SessionKey, participant: string): void {
  const state = findSession(key);
  if (state === undefined) return;
  state.participants.delete(participant);
  retireIfUnused(sessionKeyId(key), state);
}

function retireIfUnused(id: string, state: SessionState): void {
  if (state.participants.size > 0) return;
  const inflight = state.watchTransaction;
  if (inflight !== null) {
    const retry = () => retireIfUnused(id, state);
    inflight.then(retry, retry);
    return;
  }
  const sessions = sessionRegistry().sessions;
  if (sessions.get(id) !== state) return;
  sessions.delete(id);
  sessionRegistry().engines.delete(id);
  state.claimRecord?.();
  state.claimRecord = null;
}

/** The registry's global slot, which test harnesses clear. */
export const SESSION_REGISTRY_KEY = SESSION_REGISTRY;
