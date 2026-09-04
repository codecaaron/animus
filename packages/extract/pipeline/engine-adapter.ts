/**
 * The v2 `ExtractEngine` adapter, hoisted to one authoritative copy.
 *
 * Both extraction plugins (next-plugin, vite-plugin) drive the stateful v2
 * `ExtractEngine` through the engine-agnostic surface the v1 native module
 * already exposes (loadSystemModule / analyzeProject / transformFile /
 * clearAnalysisCache). This factory builds that surface once; the plugins
 * differ only in (a) how the engine option is resolved, (b) how the native
 * module is loaded, and (c) where the per-run state lives — so those are the
 * injected dependencies.
 *
 * State storage is the pivotal difference: next-plugin must survive the
 * ESM/CJS double-load (the plugin loads as ESM via next.config, the webpack
 * loader via CJS require), so it backs the store with globalThis; vite-plugin
 * keeps per-plugin-instance state in closure variables. The one-shot drift
 * flag lives in the store too, so next's warning stays one-shot across the
 * double-load.
 *
 * Loading semantics (lazy CJS require, fail-loud, no silent fallback to the
 * other engine) live at the call site via `loadNativeEngine`; this module
 * never imports the native binding, and never imports from either plugin,
 * webpack, or vite (dependency direction: plugins -> extract).
 */

import { parseFilesJson } from './source-ingestion';

/** The stateful v2 engine handle produced by `new native.ExtractEngine(...)`. */
export interface V2ExtractEngine {
  analyze(filesJson: string): string;
  transformFile(path: string): string;
  clearCache(): void;
}

/** Per-file transform result, as both plugins consume it. */
export interface TransformFileResult {
  code: string;
  hasComponents: boolean;
}

/**
 * The engine-agnostic API surface. The v1 leg is the raw native module (which
 * already exposes these methods); the v2 leg is the adapter this factory
 * builds. The positional `analyzeProject` tuple mirrors the NAPI contract in
 * `analyze-project-args.ts`.
 */
export interface EngineApi {
  // The native module's own generated typings are authoritative for the config
  // it returns, so the surface stays loose here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  loadSystemModule: (...args: unknown[]) => any;
  /** Parse-only native fact extraction used to prepare adapted sources. */
  extractFacts?: (filesJson: string) => string;
  analyzeProject: (
    filesJson: string,
    scalesJson: string,
    variableMapJson: string,
    contextualVarsJson: string | null,
    propConfigJson: string,
    groupRegistryJson: string,
    packageResolutionJson: string,
    devMode: boolean,
    emitterConfigJson: string | null,
    selectorAliasesJson: string | null,
    selectorOrderJson: string | null,
    globalStyleBlocksJson: string | null,
    pathAliasesJson: string | null,
    keyframesJson: string | null,
    staticCssJson: string | null,
    conditionAliasesJson: string | null,
    externalDirsJson: string | null,
    transformSourcesJson: string | null
  ) => string;
  transformFile: (
    source: string,
    path: string,
    manifest: string
  ) => TransformFileResult;
  clearAnalysisCache: () => void;
}

/**
 * Storage for the per-run engine instance, the analyze-time sources (drift
 * detection), and the one-shot drift flag. next backs this with globalThis;
 * vite with closure variables.
 */
export interface V2EngineStateStore {
  getEngine(): V2ExtractEngine | null;
  setEngine(engine: V2ExtractEngine | null): void;
  getSentSources(): Map<string, string> | null;
  setSentSources(sources: Map<string, string> | null): void;
  getDriftWarned(): boolean;
  setDriftWarned(value: boolean): void;
}

/** The native engine module. Its own generated `.d.ts` is authoritative. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type NativeEngineModule = any;

/**
 * Constructor config for the v2 `ExtractEngine`. NAPI `Option<String>` object
 * fields accept `undefined` (→ None) but REJECT `null`, so every optional is
 * coerced with `?? undefined` at the call site.
 */
interface V2ExtractEngineConfig {
  runtimeImport?: string;
  cssModuleId?: string;
  systemPropsModuleId?: string;
  themeJson: string;
  variableMapJson: string;
  contextualVarsJson?: string;
  configJson: string;
  groupRegistryJson: string;
  selectorAliasesJson?: string;
  conditionAliasesJson?: string;
  globalStyleBlocksJson?: string;
  keyframesJson?: string;
  packageResolutionJson?: string;
  pathAliasesJson?: string;
  staticCssJson?: string;
  externalDirsJson?: string;
  transformSourcesJson?: string;
  devMode: boolean;
}

export interface V2EngineAdapterDeps {
  /** Log label for the drift warning and the fail-loud transform error
   *  (e.g. 'animus-next', 'animus-extract'). */
  label: string;
  /** Whether v2 is selected. When false, `engineApi()` returns the raw native
   *  module unchanged (the v1 leg). next reads the shared engine choice from
   *  globalThis; vite the per-plugin resolved option. */
  isV2(): boolean;
  /** Require the native engine module. Loading semantics — lazy CJS require,
   *  fail-loud, no silent fallback — live here. */
  loadNativeEngine(): NativeEngineModule;
  /** Per-run state storage (globalThis for next, closure for vite). */
  store: V2EngineStateStore;
  /** When true, `transformFile` passes paths absent from the last `analyze()`
   *  set through unchanged (v1 parity: the webpack loader hands the adapter
   *  files outside the analysis universe — generated `.animus/*` modules,
   *  workspace-resolved library dist; vite pre-filters them, so it leaves this
   *  off). */
  passThroughUnknownPaths?: boolean;
  /** Optional pre-analyze re-hydration of empty sources. vite's HMR sends
   *  empty sources for unchanged files and v2 has no Rust-side cache, so vite
   *  refills them from its own file cache before analyze; next always sends
   *  full sources. Identity when omitted. */
  rehydrateFilesJson?(filesJsonRaw: string): string;
}

/**
 * Build the engine-agnostic `engineApi()` both plugins call. Returns a function
 * (invoked per call site) so `isV2()` and `loadNativeEngine()` re-evaluate each
 * time — next reads its engine choice and native module dynamically from
 * globalThis.
 */
export function createV2EngineApi(deps: V2EngineAdapterDeps): () => EngineApi {
  const { label, isV2, loadNativeEngine, store } = deps;
  return (): EngineApi => {
    if (!isV2()) {
      // SAFETY: the v1 leg IS the native module — `EngineApi` was derived from
      // the surface `animus-extract-v2`'s NAPI entry points already export
      // (loadSystemModule / analyzeProject /
      // transformFile / clearAnalysisCache), which is why the v2 adapter below
      // can mimic it. The module's own generated `index.d.ts` is authoritative
      // and `loadNativeEngine` is declared `any`, so this names the surface the
      // callers get rather than widening one.
      return loadNativeEngine() as EngineApi;
    }
    const native = loadNativeEngine();
    return {
      loadSystemModule: (...args: unknown[]) =>
        native.loadSystemModule(...args),
      extractFacts: (filesJson) => native.extractFacts(filesJson),
      analyzeProject: (
        filesJsonRaw,
        scalesJson,
        variableMapJson,
        contextualVarsJson,
        propConfigJson,
        groupRegistryJson,
        packageResolutionJson,
        devMode,
        emitterConfigJson,
        selectorAliasesJson,
        _selectorOrderJson,
        globalStyleBlocksJson,
        pathAliasesJson,
        keyframesJson,
        staticCssJson,
        conditionAliasesJson,
        externalDirsJson,
        transformSourcesJson
      ) => {
        const filesJson = deps.rehydrateFilesJson
          ? deps.rehydrateFilesJson(filesJsonRaw)
          : filesJsonRaw;

        // Record analyze-time sources for the transform-time drift check.
        const sent = new Map<string, string>();
        for (const entry of parseFilesJson(filesJson, label)) {
          sent.set(entry.path, entry.source);
        }
        store.setSentSources(sent);

        // v1 EmitterConfig rides positionally; pass its fields through so the
        // plugin's runtime subpath and custom css/system-props module ids reach
        // the engine (dropping them silently rewires imports).
        // SAFETY: `emitterConfigJson` is animus's own wire — `buildAnalysisInputs`
        // (`run-analysis.ts`) is its only producer and writes exactly these three
        // snake_case keys from `EmitterConfig`. Every field is read back
        // optionally below (`?? undefined`), so a producer that stops emitting
        // one degrades to the engine's own default rather than to a wrong value.
        const emitterConfig = emitterConfigJson
          ? (JSON.parse(emitterConfigJson) as {
              runtime_import?: string;
              css_module_id?: string;
              system_props_module_id?: string;
            })
          : {};

        // Stale-engine window: clear BEFORE constructing so a constructor throw
        // can't leave a previous instance serving.
        store.setEngine(null);

        const config: V2ExtractEngineConfig = {
          runtimeImport: emitterConfig.runtime_import ?? undefined,
          cssModuleId: emitterConfig.css_module_id ?? undefined,
          systemPropsModuleId:
            emitterConfig.system_props_module_id ?? undefined,
          themeJson: scalesJson,
          variableMapJson,
          contextualVarsJson: contextualVarsJson ?? undefined,
          configJson: propConfigJson,
          groupRegistryJson,
          selectorAliasesJson: selectorAliasesJson ?? undefined,
          conditionAliasesJson: conditionAliasesJson ?? undefined,
          globalStyleBlocksJson: globalStyleBlocksJson ?? undefined,
          keyframesJson: keyframesJson ?? undefined,
          packageResolutionJson: packageResolutionJson ?? undefined,
          pathAliasesJson: pathAliasesJson ?? undefined,
          staticCssJson: staticCssJson ?? undefined,
          externalDirsJson: externalDirsJson ?? undefined,
          transformSourcesJson: transformSourcesJson ?? undefined,
          devMode,
        };
        // SAFETY: `native` is the loaded `animus-extract-v2` module, whose
        // generated `crates/extract-v2/index.d.ts` declares `ExtractEngine`
        // with exactly the three methods `V2ExtractEngine` names. The
        // declaration is `any` only because this module refuses to import the
        // native binding (see the header's dependency-direction rule); a
        // missing method surfaces on the very next line's `analyze` call.
        const engine = new native.ExtractEngine(config) as V2ExtractEngine;
        store.setEngine(engine);
        return engine.analyze(filesJson);
      },
      transformFile: (source, path, _manifest) => {
        const engine = store.getEngine();
        if (!engine) {
          throw new Error(
            `[${label}] v2 transform before analyze — engine instance not initialized`
          );
        }
        // v1 parity: files deliberately outside the analysis universe were
        // returned unchanged by v1. The stateful engine would fail loud on
        // them, and unchanged is the correct output.
        const sentMap = store.getSentSources();
        if (deps.passThroughUnknownPaths && sentMap && !sentMap.has(path)) {
          return { code: source, hasComponents: false };
        }
        // v2 emits from analyze-time source; surface drift loudly, once.
        const sent = sentMap?.get(path);
        if (sent !== undefined && sent !== source && !store.getDriftWarned()) {
          store.setDriftWarned(true);
          // Drift is a build-time correctness warning; both plugins surfaced it
          // via console.warn directly before the adapter was hoisted here.
          // eslint-disable-next-line no-console
          console.warn(
            `[${label}] v2: transform-time source for ${path} differs from analyze-time source — an upstream transform may be reverted`
          );
        }
        // SAFETY: this is the engine's own serde output for the call made on
        // the line itself — `ExtractEngine.transformFile` serializes
        // `{ code, hasComponents }`. Unparseable bytes throw here, which is
        // correct: the engine emitting non-JSON is an engine bug, and a
        // substituted default would ship the untransformed source as success.
        return JSON.parse(engine.transformFile(path)) as TransformFileResult;
      },
      clearAnalysisCache: () => {
        const engine = store.getEngine();
        if (engine) engine.clearCache();
        store.setEngine(null);
      },
    };
  };
}
