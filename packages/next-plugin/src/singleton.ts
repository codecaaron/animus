/**
 * Module-scope singleton for sharing analysis state between the webpack plugin and loader.
 *
 * Uses globalThis to survive the ESM/CJS module boundary: the plugin is loaded via ESM
 * (next.config.ts import) while the loader is loaded by webpack via require(). Without
 * globalThis, each module system gets its own singleton instance.
 */
import { createV2EngineApi } from '@animus-ui/extract/pipeline';
import { randomUUID } from 'crypto';

import type { V2ExtractEngine } from '@animus-ui/extract/pipeline';

const MANIFEST_KEY = '__animus_manifest_json__';
const PROMISE_KEY = '__animus_analysis_promise__';
const SHARED_CSS_KEY = '__animus_shared_css__';
const SHARED_SYSTEM_PROPS_KEY = '__animus_shared_system_props__';
const SHARED_EXTERNAL_DIRS_KEY = '__animus_external_pkg_dirs__';
const SHARED_EXTERNAL_ENTRIES_KEY = '__animus_external_source_entries__';

export function getManifestJson(): string | null {
  return (globalThis as Record<string, unknown>)[MANIFEST_KEY] as string | null;
}

export function setManifestJson(json: string): void {
  (globalThis as Record<string, unknown>)[MANIFEST_KEY] = json;
}

export function getAnalysisPromise(): Promise<void> | null {
  return (globalThis as Record<string, unknown>)[
    PROMISE_KEY
  ] as Promise<void> | null;
}

export function setAnalysisPromise(promise: Promise<void>): void {
  (globalThis as Record<string, unknown>)[PROMISE_KEY] = promise;
}

export function resetAnalysisPromise(): void {
  (globalThis as Record<string, unknown>)[PROMISE_KEY] = null;
}

export function getSharedCss(): string {
  return (
    ((globalThis as Record<string, unknown>)[SHARED_CSS_KEY] as string) || ''
  );
}

export function setSharedCss(css: string): void {
  (globalThis as Record<string, unknown>)[SHARED_CSS_KEY] = css;
}

export function setSharedSystemProps(content: string): void {
  (globalThis as Record<string, unknown>)[SHARED_SYSTEM_PROPS_KEY] = content;
}

export function getSharedExternalDirs(): string[] {
  return (
    ((globalThis as Record<string, unknown>)[
      SHARED_EXTERNAL_DIRS_KEY
    ] as string[]) || []
  );
}

export function setSharedExternalDirs(dirs: string[]): void {
  (globalThis as Record<string, unknown>)[SHARED_EXTERNAL_DIRS_KEY] = dirs;
}

export function getSharedExternalEntries(): Map<string, string> {
  return (
    ((globalThis as Record<string, unknown>)[
      SHARED_EXTERNAL_ENTRIES_KEY
    ] as Map<string, string>) || new Map()
  );
}

export function setSharedExternalEntries(entries: Map<string, string>): void {
  (globalThis as Record<string, unknown>)[SHARED_EXTERNAL_ENTRIES_KEY] =
    entries;
}

/** One typed globalThis slot — the single accessor shape every
 *  singleton-published value shares (null when unset). */
function globalSlot<T>(key: string): {
  get(): T | null;
  set(value: T | null): void;
} {
  const store = globalThis as Record<string, unknown>;
  return {
    get: () => (store[key] as T | undefined) ?? null,
    set: (value) => {
      store[key] = value;
    },
  };
}

const ANALYZED_HASHES_KEY = '__animus_analyzed_hashes__';
const REPLACEMENT_EPOCH_KEY = '__animus_replacement_epoch__';
const WATCH_TRANSACTION_KEY = '__animus_watch_transaction__';
const PROCESS_SESSION_ID_KEY = '__animus_process_session_id__';
const SESSION_ARTIFACT_DIR_KEY = '__animus_session_artifact_dir__';
const OWNING_WATCH_SESSION_KEY = '__animus_owning_watch_session__';

const analyzedHashesSlot = globalSlot<Map<string, string>>(ANALYZED_HASHES_KEY);
const replacementEpochSlot = globalSlot<string>(REPLACEMENT_EPOCH_KEY);
const watchTransactionSlot = globalSlot<Promise<void>>(WATCH_TRANSACTION_KEY);
const sessionArtifactDirSlot = globalSlot<string>(SESSION_ARTIFACT_DIR_KEY);

/** Structural view of the owning session a forwarded watch batch targets —
 *  kept minimal (and defined here, not imported) so the singleton never
 *  depends on the session module it serves. */
export interface WatchBatchTarget {
  ingestForwardedBatch(changes: {
    modifiedFiles?: ReadonlySet<string>;
    removedFiles?: ReadonlySet<string>;
  }): Promise<void>;
}

const owningWatchSessionSlot = globalSlot<WatchBatchTarget>(
  OWNING_WATCH_SESSION_KEY
);

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
  const store = globalThis as Record<string, unknown>;
  const existing = store[PROCESS_SESSION_ID_KEY];
  if (typeof existing === 'string' && existing.length > 0) return existing;
  const fresh = randomUUID();
  store[PROCESS_SESSION_ID_KEY] = fresh;
  return fresh;
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

const ENGINE_KEY = '__animus_engine__';

export type AnimusEngine = 'v2';

/** Engine selection travels through the singleton so non-owning compiler
 *  instances and the webpack loader honor the same choice as the owner. */
export function setSharedEngine(engine: AnimusEngine): void {
  (globalThis as Record<string, unknown>)[ENGINE_KEY] = engine;
}

export function getSharedEngine(): AnimusEngine {
  // Fallback mirrors the plugin default (v2 since extract-v2-default-flip)
  // so a loader read that races the owning constructor cannot split the
  // process across engines.
  return (
    ((globalThis as Record<string, unknown>)[ENGINE_KEY] as AnimusEngine) ||
    'v2'
  );
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

const V2_ENGINE_KEY = '__animus_v2_engine__';

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
const V2_SENT_SOURCES_KEY = '__animus_v2_sent_sources__';
const V2_DRIFT_WARNED_KEY = '__animus_v2_drift_warned__';

const v2EngineApi = createV2EngineApi({
  label: 'animus-next',
  isV2: () => getSharedEngine() === 'v2',
  loadNativeEngine: requireEngine,
  // The webpack loader hands the adapter files outside the analysis universe
  // (generated .animus/* modules, workspace-resolved library dist); pass them
  // through unchanged for v1 parity.
  passThroughUnknownPaths: true,
  store: {
    getEngine: () =>
      (globalThis as Record<string, unknown>)[
        V2_ENGINE_KEY
      ] as V2ExtractEngine | null,
    setEngine: (engine) => {
      (globalThis as Record<string, unknown>)[V2_ENGINE_KEY] = engine;
    },
    getSentSources: () =>
      ((globalThis as Record<string, unknown>)[V2_SENT_SOURCES_KEY] as
        | Map<string, string>
        | undefined) ?? null,
    setSentSources: (sources) => {
      (globalThis as Record<string, unknown>)[V2_SENT_SOURCES_KEY] = sources;
    },
    getDriftWarned: () =>
      Boolean((globalThis as Record<string, unknown>)[V2_DRIFT_WARNED_KEY]),
    setDriftWarned: (value) => {
      (globalThis as Record<string, unknown>)[V2_DRIFT_WARNED_KEY] = value;
    },
  },
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function engineApi(): any {
  return v2EngineApi();
}

/**
 * Every globalThis key this module owns — the single authority test
 * harnesses snapshot/clear per test (never re-declare this list).
 */
export const SINGLETON_GLOBAL_KEYS = [
  MANIFEST_KEY,
  PROMISE_KEY,
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
  ENGINE_KEY,
  V2_ENGINE_KEY,
  V2_SENT_SOURCES_KEY,
  V2_DRIFT_WARNED_KEY,
] as const;
