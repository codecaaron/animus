/**
 * Module-scope singleton for sharing analysis state between the webpack plugin and loader.
 *
 * Uses globalThis to survive the ESM/CJS module boundary: the plugin is loaded via ESM
 * (next.config.ts import) while the loader is loaded by webpack via require(). Without
 * globalThis, each module system gets its own singleton instance.
 */

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
 * v2 leg adapts the v1 function surface onto a stateful ExtractEngine;
 * the INSTANCE lives on globalThis for the same reason the manifest
 * does — the ESM plugin and the CJS webpack loader must see one engine.
 * (The next-plugin is already process-singleton by design: manifest,
 * css, and system props share the same globalThis keys.)
 * loadSystemModule is exported by both bindings from one engine-neutral
 * Rust crate, so the default path no longer loads the v1 binary.
 */
const V2_SENT_SOURCES_KEY = '__animus_v2_sent_sources__';
let v2DriftWarned = false;

export function engineApi(): any {
  if (getSharedEngine() !== 'v2') return requireEngine();
  const native = requireEngine();
  return {
    loadSystemModule: (...args: unknown[]) => native.loadSystemModule(...args),
    analyzeProject: (
      filesJson: string,
      themeJson: string,
      variableMapJson: string,
      contextualVarsJson: string | null,
      configJson: string,
      groupRegistryJson: string,
      packageResolutionJson: string,
      devMode: boolean,
      emitterConfigJson: string | null,
      selectorAliasesJson: string | null,
      _selectorOrderJson: string | null,
      globalStyleBlocksJson: string | null,
      pathAliasesJson: string | null,
      keyframesJson: string | null
    ) => {
      const sent = new Map<string, string>();
      for (const entry of JSON.parse(filesJson) as Array<{
        path: string;
        source: string;
      }>) {
        sent.set(entry.path, entry.source);
      }
      (globalThis as Record<string, unknown>)[V2_SENT_SOURCES_KEY] = sent;
      // v1 EmitterConfig rides positionally; pass its fields through
      // (row-13 review A2 — the Next plugin sets a runtime subpath and
      // custom css/system-props module ids).
      const emitterConfig = emitterConfigJson
        ? (JSON.parse(emitterConfigJson) as {
            runtime_import?: string;
            css_module_id?: string;
            system_props_module_id?: string;
          })
        : {};
      // Stale-engine window (A4): clear BEFORE constructing.
      (globalThis as Record<string, unknown>)[V2_ENGINE_KEY] = null;
      // NAPI Option<String> object fields accept `undefined` (→ None)
      // but REJECT `null`.
      const engine = new native.ExtractEngine({
        runtimeImport: emitterConfig.runtime_import ?? undefined,
        cssModuleId: emitterConfig.css_module_id ?? undefined,
        systemPropsModuleId: emitterConfig.system_props_module_id ?? undefined,
        themeJson,
        variableMapJson,
        contextualVarsJson: contextualVarsJson ?? undefined,
        configJson,
        groupRegistryJson,
        selectorAliasesJson: selectorAliasesJson ?? undefined,
        globalStyleBlocksJson: globalStyleBlocksJson ?? undefined,
        keyframesJson: keyframesJson ?? undefined,
        packageResolutionJson: packageResolutionJson ?? undefined,
        pathAliasesJson: pathAliasesJson ?? undefined,
        devMode,
      });
      (globalThis as Record<string, unknown>)[V2_ENGINE_KEY] = engine;
      return engine.analyze(filesJson);
    },
    transformFile: (source: string, path: string, _manifest: string) => {
      const engine = (globalThis as Record<string, unknown>)[V2_ENGINE_KEY] as {
        transformFile: (p: string) => string;
      } | null;
      if (!engine) {
        throw new Error(
          '[animus-next] v2 transform before analyze — engine instance not initialized'
        );
      }
      // A3: v2 emits from analyze-time source; surface drift loudly once.
      const sentMap = (globalThis as Record<string, unknown>)[
        V2_SENT_SOURCES_KEY
      ] as Map<string, string> | undefined;
      const sent = sentMap?.get(path);
      if (sent !== undefined && sent !== source && !v2DriftWarned) {
        v2DriftWarned = true;
        console.warn(
          `[animus-next] v2: transform-time source for ${path} differs from analyze-time source — an upstream transform may be reverted`
        );
      }
      return JSON.parse(engine.transformFile(path));
    },
    clearAnalysisCache: () => {
      const engine = (globalThis as Record<string, unknown>)[V2_ENGINE_KEY] as {
        clearCache: () => void;
      } | null;
      if (engine) engine.clearCache();
      (globalThis as Record<string, unknown>)[V2_ENGINE_KEY] = null;
    },
  };
}
