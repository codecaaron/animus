import { randomUUID } from 'crypto';

/**
 * globalThis-backed so the ESM plugin copy and the CJS webpack-loader copy
 * share one store; module scope alone gives each copy its own instance.
 */
import { createV2EngineApi } from '../pipeline/index';

import type { V2ExtractEngine } from '../pipeline/index';

const MANIFEST_KEY = '__animus_manifest_json__';
const ANALYSIS_STARTED_KEY = '__animus_analysis_started__';
const SHARED_CSS_KEY = '__animus_shared_css__';
const SHARED_SYSTEM_PROPS_KEY = '__animus_shared_system_props__';
const SHARED_EXTERNAL_DIRS_KEY = '__animus_external_pkg_dirs__';
const SHARED_EXTERNAL_ENTRIES_KEY = '__animus_external_source_entries__';
const ANALYZED_HASHES_KEY = '__animus_analyzed_hashes__';
const REPLACEMENT_EPOCH_KEY = '__animus_replacement_epoch__';
const WATCH_TRANSACTION_KEY = '__animus_watch_transaction__';
const PROCESS_SESSION_ID_KEY = '__animus_process_session_id__';
const SESSION_ARTIFACT_DIR_KEY = '__animus_session_artifact_dir__';
const OWNING_WATCH_SESSION_KEY = '__animus_owning_watch_session__';
const EXCLUSIVE_SESSION_OWNER_KEY = '__animus_exclusive_session_owner__';
const ENGINE_KEY = '__animus_engine__';
const V2_ENGINE_KEY = '__animus_v2_engine__';
const V2_SENT_SOURCES_KEY = '__animus_v2_sent_sources__';
const V2_DRIFT_WARNED_KEY = '__animus_v2_drift_warned__';
const ENGINE_API_OVERRIDE_KEY = '__animus_engine_api_override__';

interface AnimusSingletonStore {
  [MANIFEST_KEY]: string | null;
  [ANALYSIS_STARTED_KEY]: Promise<void> | null;
  [SHARED_CSS_KEY]: string;
  [SHARED_SYSTEM_PROPS_KEY]: string;
  [SHARED_EXTERNAL_DIRS_KEY]: string[];
  [SHARED_EXTERNAL_ENTRIES_KEY]: Map<string, string>;
  [ANALYZED_HASHES_KEY]: Map<string, string> | null;
  [REPLACEMENT_EPOCH_KEY]: string | null;
  [WATCH_TRANSACTION_KEY]: Promise<void> | null;
  [PROCESS_SESSION_ID_KEY]: string | undefined;
  [SESSION_ARTIFACT_DIR_KEY]: string | null;
  [OWNING_WATCH_SESSION_KEY]: WatchBatchTarget | null;
  [EXCLUSIVE_SESSION_OWNER_KEY]: string | undefined;
  [ENGINE_KEY]: AnimusEngine | undefined;
  [V2_ENGINE_KEY]: V2ExtractEngine | null;
  [V2_SENT_SOURCES_KEY]: Map<string, string> | null | undefined;
  [V2_DRIFT_WARNED_KEY]: boolean | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [ENGINE_API_OVERRIDE_KEY]: (() => any) | undefined;
}

// SAFETY: this module is the sole owner of these fixed globalThis keys, and
// every write through the store is checked against AnimusSingletonStore.
const singletonGlobal = globalThis as typeof globalThis & AnimusSingletonStore;
const singletonStore: AnimusSingletonStore = singletonGlobal;

const isSingletonString = <Value>(value: Value): value is Value & string => {
  if (Object(value) === value) return false;
  try {
    String.prototype.valueOf.call(value);
    return true;
  } catch {
    return false;
  }
};

export function getManifestJson(): string | null {
  return singletonStore[MANIFEST_KEY];
}

export function setManifestJson(json: string): void {
  singletonStore[MANIFEST_KEY] = json;
}

/**
 * A latch over the most recently STARTED analysis, never cleared on settle:
 * non-null means one was scheduled. In-flight lives in getWatchTransaction.
 */
export function getAnalysisStartedPromise(): Promise<void> | null {
  return singletonStore[ANALYSIS_STARTED_KEY];
}

export function setAnalysisStartedPromise(promise: Promise<void>): void {
  singletonStore[ANALYSIS_STARTED_KEY] = promise;
}

export function resetAnalysisStartedPromise(): void {
  singletonStore[ANALYSIS_STARTED_KEY] = null;
}

export function getSharedCss(): string {
  return singletonStore[SHARED_CSS_KEY] || '';
}

export function setSharedCss(css: string): void {
  singletonStore[SHARED_CSS_KEY] = css;
}

export function getSharedSystemProps(): string {
  return singletonStore[SHARED_SYSTEM_PROPS_KEY] || '';
}

export function setSharedSystemProps(content: string): void {
  singletonStore[SHARED_SYSTEM_PROPS_KEY] = content;
}

export function getSharedExternalDirs(): string[] {
  return singletonStore[SHARED_EXTERNAL_DIRS_KEY] || [];
}

export function setSharedExternalDirs(dirs: string[]): void {
  singletonStore[SHARED_EXTERNAL_DIRS_KEY] = dirs;
}

export function getSharedExternalEntries(): Map<string, string> {
  return singletonStore[SHARED_EXTERNAL_ENTRIES_KEY] || new Map();
}

export function setSharedExternalEntries(entries: Map<string, string>): void {
  singletonStore[SHARED_EXTERNAL_ENTRIES_KEY] = entries;
}

type NullableSingletonKey =
  | typeof ANALYZED_HASHES_KEY
  | typeof REPLACEMENT_EPOCH_KEY
  | typeof WATCH_TRANSACTION_KEY
  | typeof SESSION_ARTIFACT_DIR_KEY
  | typeof OWNING_WATCH_SESSION_KEY;

interface AnimusSingletonSlot<Key extends NullableSingletonKey> {
  get(): AnimusSingletonStore[Key];
  set(value: AnimusSingletonStore[Key]): void;
}

function globalSlot<Key extends NullableSingletonKey>(
  key: Key
): AnimusSingletonSlot<Key> {
  return {
    get: () => singletonStore[key] ?? null,
    set: (value) => {
      singletonStore[key] = value;
    },
  };
}

const analyzedHashesSlot = globalSlot(ANALYZED_HASHES_KEY);
const replacementEpochSlot = globalSlot(REPLACEMENT_EPOCH_KEY);
const watchTransactionSlot = globalSlot(WATCH_TRANSACTION_KEY);
const sessionArtifactDirSlot = globalSlot(SESSION_ARTIFACT_DIR_KEY);

/** Structural view of the target session, declared here rather than imported
 *  so the singleton never depends on the session module it serves. */
export interface WatchBatchTarget {
  ingestForwardedBatch(changes: {
    modifiedFiles?: ReadonlySet<string>;
    removedFiles?: ReadonlySet<string>;
  }): Promise<void>;
}

const owningWatchSessionSlot = globalSlot(OWNING_WATCH_SESSION_KEY);

/**
 * The only session that can run watch analysis. A non-owning session forwards
 * its batch here; dropping it loses files only that watcher sees.
 */
export function getOwningWatchSession(): WatchBatchTarget | null {
  return owningWatchSessionSlot.get();
}

export function setOwningWatchSession(session: WatchBatchTarget | null): void {
  owningWatchSessionSlot.set(session);
}

/**
 * Per-file content hashes of the last published analysis (relPath → hash of
 * the exact bytes analyzed), including files that produced zero entries.
 */
export function getAnalyzedHashes(): ReadonlyMap<string, string> | null {
  return analyzedHashesSlot.get();
}

export function setAnalyzedHashes(hashes: Map<string, string>): void {
  analyzedHashesSlot.set(hashes);
}

/**
 * Session identity is per process: the first caller claims a fresh id and
 * every later one adopts it, so all compilers share one artifact tree.
 */
export function claimProcessSessionId(): string {
  const existing = singletonStore[PROCESS_SESSION_ID_KEY];
  if (isSingletonString(existing) && existing.length > 0) return existing;
  const fresh = randomUUID();
  singletonStore[PROCESS_SESSION_ID_KEY] = fresh;
  return fresh;
}

/**
 * Two CONCURRENT drive loops in one process would share one session tree and
 * clobber each other; sequential claim/release cycles are legal.
 */
export function claimExclusiveSessionOwner(label: string): () => void {
  const active = singletonStore[EXCLUSIVE_SESSION_OWNER_KEY];
  if (isSingletonString(active)) {
    throw new Error(
      `[animus] a second Animus host ("${label}") started while "${active}" ` +
        `is still active in this process. The extraction session is ` +
        `process-global (one session tree, one manifest), so concurrent ` +
        `hosts would clobber each other's analysis. Run one Animus-enabled ` +
        `config per process, or make the builds sequential.`
    );
  }
  singletonStore[EXCLUSIVE_SESSION_OWNER_KEY] = label;
  return () => {
    if (singletonStore[EXCLUSIVE_SESSION_OWNER_KEY] === label) {
      delete singletonStore[EXCLUSIVE_SESSION_OWNER_KEY];
    }
  };
}

/**
 * Absolute artifact directory of the OWNING session's last publication. The
 * Turbopack loader runs out of process and receives it via options instead.
 */
export function getSessionArtifactDir(): string | null {
  return sessionArtifactDirSlot.get();
}

export function setSessionArtifactDir(dir: string): void {
  sessionArtifactDirSlot.set(dir);
}

/**
 * Replacement epoch of the last published analysis, written AFTER the
 * manifest so an epoch reader always sees at least that generation's manifest.
 */
export function getReplacementEpoch(): string | null {
  return replacementEpochSlot.get();
}

export function setReplacementEpoch(epoch: string): void {
  replacementEpochSlot.set(epoch);
}

/**
 * The one in-flight watch-analysis transaction: a compiler that did not start
 * it joins this promise rather than read a pre-transaction generation.
 */
export function getWatchTransaction(): Promise<void> | null {
  return watchTransactionSlot.get();
}

export function setWatchTransaction(transaction: Promise<void> | null): void {
  watchTransactionSlot.set(transaction);
}

export type AnimusEngine = 'v2';

/** Engine selection travels through the singleton so non-owning compilers
 *  and the webpack loader honor the owner's choice. */
export function setSharedEngine(engine: AnimusEngine): void {
  singletonStore[ENGINE_KEY] = engine;
}

export function getSharedEngine(): AnimusEngine {
  // Fallback mirrors the plugin default so a loader read that races the
  // owning constructor cannot split the process across engines.
  return singletonStore[ENGINE_KEY] || 'v2';
}

/** Single choke-point for every native extraction call; the NAPI module's
 *  own `.d.ts` is the authoritative surface for what it returns. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function requireEngine(): any {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@animus-ui/extract');
}

/**
 * The one engine API for this process: the instance, its analyze-time
 * sources, and the drift flag live on globalThis so both copies share them.
 */
const v2EngineApi = createV2EngineApi({
  // Driver-neutral: every driver reaches this one instance, so a
  // host-branded label misattributes drift warnings.
  label: 'animus',
  isV2: () => getSharedEngine() === 'v2',
  loadNativeEngine: requireEngine,
  passThroughUnknownPaths: true,
  store: {
    getEngine: () => singletonStore[V2_ENGINE_KEY],
    setEngine: (engine) => {
      singletonStore[V2_ENGINE_KEY] = engine;
    },
    getSentSources: () => singletonStore[V2_SENT_SOURCES_KEY] ?? null,
    setSentSources: (sources) => {
      singletonStore[V2_SENT_SOURCES_KEY] = sources;
    },
    getDriftWarned: () => Boolean(singletonStore[V2_DRIFT_WARNED_KEY]),
    setDriftWarned: (value) => {
      singletonStore[V2_DRIFT_WARNED_KEY] = value;
    },
  },
});

/**
 * Test seam, set once at module top level: this key stays OUT of
 * SINGLETON_GLOBAL_KEYS so a per-test reset cannot strip the override.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function setEngineApiOverride(api: (() => any) | null): void {
  singletonStore[ENGINE_API_OVERRIDE_KEY] = api ?? undefined;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function engineApi(): any {
  const override = singletonStore[ENGINE_API_OVERRIDE_KEY];
  return override ? override() : v2EngineApi();
}

/**
 * Every globalThis key this module owns except the engine-api override, which
 * a per-test reset must not clear. Test harnesses clear exactly this list.
 */
export const SINGLETON_GLOBAL_KEYS = [
  MANIFEST_KEY,
  ANALYSIS_STARTED_KEY,
  SHARED_CSS_KEY,
  SHARED_SYSTEM_PROPS_KEY,
  SHARED_EXTERNAL_DIRS_KEY,
  SHARED_EXTERNAL_ENTRIES_KEY,
  ANALYZED_HASHES_KEY,
  REPLACEMENT_EPOCH_KEY,
  WATCH_TRANSACTION_KEY,
  PROCESS_SESSION_ID_KEY,
  SESSION_ARTIFACT_DIR_KEY,
  OWNING_WATCH_SESSION_KEY,
  EXCLUSIVE_SESSION_OWNER_KEY,
  ENGINE_KEY,
  V2_ENGINE_KEY,
  V2_SENT_SOURCES_KEY,
  V2_DRIFT_WARNED_KEY,
] as const;
