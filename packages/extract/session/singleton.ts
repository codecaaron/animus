import { randomUUID } from 'crypto';

/**
 * Module-scope singleton for sharing analysis state between the webpack plugin and loader.
 *
 * Uses globalThis to survive the ESM/CJS module boundary: the plugin is loaded via ESM
 * (next.config.ts import) while the loader is loaded by webpack via require(). Without
 * globalThis, each module system gets its own singleton instance.
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

// SAFETY: This module is the sole owner of these fixed globalThis keys. Every
// write below is checked against AnimusSingletonStore, while using globalThis
// itself preserves sharing between the ESM and CJS copies of this module.
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
 * Once-LATCH over the most recently STARTED analysis, not an in-flight
 * gate: it is never cleared on settle, so a non-null value means "an
 * analysis has been scheduled in this process", and awaiting a settled
 * promise is a no-op. The webpack plugin's compiler taps use it to elect
 * one pipeline driver among the client/server/RSC compilers. The in-flight
 * question — "is a publishing transaction running right now?" — has exactly
 * one slot, `getWatchTransaction()`.
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

/** One typed globalThis slot — the single accessor shape every
 *  singleton-published value shares (null when unset). */
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

/** Structural view of the owning session a forwarded watch batch targets —
 *  kept minimal (and defined here, not imported) so the singleton never
 *  depends on the session module it serves. */
export interface WatchBatchTarget {
  ingestForwardedBatch(changes: {
    modifiedFiles?: ReadonlySet<string>;
    removedFiles?: ReadonlySet<string>;
  }): Promise<void>;
}

const owningWatchSessionSlot = globalSlot(OWNING_WATCH_SESSION_KEY);

/**
 * The session that completed the full pipeline and holds system state — the
 * only instance that can run watch analysis. Each MultiCompiler child holds
 * its own session AND its own watcher with its own modified set; a
 * non-owning session forwards its batch here instead of dropping it (a file
 * only that compiler watches would otherwise never be analyzed).
 */
export function getOwningWatchSession(): WatchBatchTarget | null {
  return owningWatchSessionSlot.get();
}

export function setOwningWatchSession(session: WatchBatchTarget | null): void {
  owningWatchSessionSlot.set(session);
}

/**
 * Per-file analyzed content hashes of the last published analysis (relPath →
 * contentHash of the exact bytes analyzed) — the loader's witness for the
 * unconditional catching-up guard (openspec:
 * next-webpack-served-transform-coherence, design D4). Includes files
 * analyzed with ZERO animus entries: analyzed identity is membership in the
 * analysis input set, not manifest entry count.
 */
export function getAnalyzedHashes(): ReadonlyMap<string, string> | null {
  return analyzedHashesSlot.get();
}

export function setAnalyzedHashes(hashes: Map<string, string>): void {
  analyzedHashesSlot.set(hashes);
}

/**
 * Session identity is per Next INVOCATION — one process, however many
 * compiler instances it holds (openspec:
 * next-turbopack-served-transform-coherence, design D2). The first
 * ExtractionSession constructed in a process claims a fresh randomUUID;
 * every later instance (client/server/RSC compilers each construct one)
 * adopts it, so all compilers alias, watch-ignore, and publish ONE
 * session-scoped artifact tree. Separate invocations (`next dev` +
 * `next build` co-writing) are separate processes and therefore separate
 * sessions by construction.
 */
export function claimProcessSessionId(): string {
  const existing = singletonStore[PROCESS_SESSION_ID_KEY];
  if (isSingletonString(existing) && existing.length > 0) return existing;
  const fresh = randomUUID();
  singletonStore[PROCESS_SESSION_ID_KEY] = fresh;
  return fresh;
}

/**
 * Exclusive-ownership claim over the process-global session state — the
 * hard form of the invariant `claimProcessSessionId` documents softly. The
 * shared slots above (manifest, css, artifact dir) plus the one session id
 * mean two CONCURRENT drive loops in one process (a webpack MultiCompiler
 * array config, parallel rollup array builds, two programmatic CLI runs)
 * would share one session directory, overwrite each other's manifests, and
 * delete each other's live trees on dispose. The claim is taken by
 * `ExtractionSession.runFullPipeline` and released by its `close()`, so
 * every driver inherits it rather than opting in; SEQUENTIAL claim/release
 * cycles are legal. Next's multi-compiler adoption path takes exactly one
 * claim (only the first tapper runs the pipeline; the rest join its
 * promise). Throws naming both claimants and the remediation on overlap.
 * The key lives in `SINGLETON_GLOBAL_KEYS`, so per-test global resets clear
 * a leaked claim.
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
 * Absolute session artifact directory of the OWNING session's last
 * publication — the webpack loader's source for the session-scoped epoch
 * dependency path (the loader shares the process with the pipeline; the
 * Turbopack loader instead receives the directory via its options).
 */
export function getSessionArtifactDir(): string | null {
  return sessionArtifactDirSlot.get();
}

export function setSessionArtifactDir(dir: string): void {
  sessionArtifactDirSlot.set(dir);
}

/**
 * Canonical replacement epoch of the last published analysis
 * (`hashReplacementPlans(snapshotFilePlans(manifest), systemPropsContent)`
 * — openspec: next-webpack-served-transform-coherence, design D5; the
 * served system-props module rides as the served-dependency witness so
 * offline system-props changes move the epoch). Published by the
 * owning session AFTER the manifest so a reader that observes the epoch
 * always observes at least that generation's manifest. (Session
 * attribution lives on the DISK epoch artifact — no in-process mirror.)
 */
export function getReplacementEpoch(): string | null {
  return replacementEpochSlot.get();
}

export function setReplacementEpoch(epoch: string): void {
  replacementEpochSlot.set(epoch);
}

/**
 * The one in-flight watch-analysis transaction (design D3): the first
 * compiler entering a watch batch runs analysis + publication; every other
 * compiler (client/server/RSC — each holds its own session instance) joins
 * this promise instead of proceeding against a pre-transaction generation.
 */
export function getWatchTransaction(): Promise<void> | null {
  return watchTransactionSlot.get();
}

export function setWatchTransaction(transaction: Promise<void> | null): void {
  watchTransactionSlot.set(transaction);
}

export type AnimusEngine = 'v2';

/** Engine selection travels through the singleton so non-owning compiler
 *  instances and the webpack loader honor the same choice as the owner. */
export function setSharedEngine(engine: AnimusEngine): void {
  singletonStore[ENGINE_KEY] = engine;
}

export function getSharedEngine(): AnimusEngine {
  // Fallback mirrors the plugin default (v2 since extract-v2-default-flip)
  // so a loader read that races the owning constructor cannot split the
  // process across engines.
  return singletonStore[ENGINE_KEY] || 'v2';
}

/** Single engine choke-point for every native extraction call. Return type
 *  mirrors the untyped `require` the call sites previously used — the NAPI
 *  module's own .d.ts is the authoritative surface. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function requireEngine(): any {
  // The package root IS the v2 engine since retire-extract-v1.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@animus-ui/extract');
}

/**
 * Engine-agnostic API over both engines (extract-v2-spine row 13). The
 * v2 leg adapts the v1 function surface onto a stateful ExtractEngine
 * (hoisted to `createV2EngineApi` in @animus-ui/extract/pipeline — the
 * single authoritative copy shared with vite-plugin). The engine INSTANCE,
 * its analyze-time sources, and the one-shot drift flag all live on
 * globalThis for the same reason the manifest does — the ESM plugin and the
 * CJS webpack loader must see one engine (and one drift warning) across the
 * double-load. (The next-plugin is already process-singleton by design:
 * manifest, css, and system props share the same globalThis keys.)
 * loadSystemModule is exported by both bindings from one engine-neutral
 * Rust crate, so the default path no longer loads the v1 binary.
 */
const v2EngineApi = createV2EngineApi({
  // Driver-neutral: this engine api is the ONE shared instance every
  // driver reaches through the singleton — a Next-branded label here
  // misattributed drift warnings under the CLI and the unplugin host
  // (inc 07 drift finding).
  label: 'animus',
  isV2: () => getSharedEngine() === 'v2',
  loadNativeEngine: requireEngine,
  // The webpack loader hands the adapter files outside the analysis universe
  // (generated .animus/* modules, workspace-resolved library dist); pass them
  // through unchanged for v1 parity.
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
 * Test seam (injected-fn pattern — module mocks cannot reach a bundled
 * dist copy of this module): inject a replacement engine API. GlobalThis-
 * keyed so every copy of this module — source-imported, dist-imported,
 * ESM/CJS dual-load — honors the one override. Pass null to restore the
 * native-backed API.
 *
 * CONTAINMENT CONTRACT (the reason the exclusion below is load-bearing).
 * Every call site is SET-ONCE: a single module-top-level statement right
 * after the imports, never inside a test body, a `beforeEach`, or a
 * `finally`, and never torn down — so the null branch has no production or
 * test caller today. Those same files call `resetAnimusGlobals()` from
 * `beforeEach`, which clears SINGLETON_GLOBAL_KEYS; keeping this key OUT of
 * that list is what stops a per-test reset from stripping an override that
 * is never re-written, which would break every test after the first in each
 * file. Nothing scopes the override BETWEEN files: containment rests
 * entirely on vitest per-file isolation (the store is plain `globalThis`,
 * and the repo's test config sets neither `isolate: false` nor a shared
 * pool). If the suite ever moves to a shared-worker pool, this seam leaks
 * across files and needs a real release handle instead.
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
 * Every globalThis key this module owns EXCEPT the engine-api override
 * (whose lifecycle belongs to the test file that set it — see
 * setEngineApiOverride) — the single authority test harnesses
 * snapshot/clear per test (never re-declare this list).
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
