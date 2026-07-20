/**
 * Module-scope singleton for sharing analysis state between the webpack plugin and loader.
 *
 * Uses globalThis to survive the ESM/CJS module boundary: the plugin is loaded via ESM
 * (next.config.ts import) while the loader is loaded by webpack via require(). Without
 * globalThis, each module system gets its own singleton instance.
 */
import { createV2EngineApi } from '@animus-ui/extract/pipeline';

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

const ENGINE_KEY = '__animus_engine__';

export type AnimusEngine = 'v1' | 'v2';

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
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(
    getSharedEngine() === 'v2'
      ? '@animus-ui/extract/engine-v2'
      : '@animus-ui/extract'
  );
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
