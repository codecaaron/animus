/**
 * One engine API for both plugins. Imports neither the native binding nor any
 * plugin or bundler — every such dependency arrives injected.
 */

import { parseFilesJson } from './source-ingestion';

/** The stateful engine handle produced by `new native.ExtractEngine(...)`. */
export interface V2ExtractEngine {
  analyze(filesJson: string): string;
  transformFile(path: string): string;
  clearCache(): void;
}

export interface TransformFileResult {
  code: string;
  hasComponents: boolean;
}

/**
 * `analyzeProject` takes its arguments positionally to mirror the NAPI
 * contract, so argument order is part of the contract.
 */
export interface EngineApi {
  // The native module's generated typings are authoritative for this value.
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
 * Per-run storage for the engine instance, the analyze-time sources drift
 * detection compares against, and the one-shot drift flag.
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
 * NAPI `Option<String>` fields accept `undefined` (→ None) but REJECT `null`,
 * so every optional is coerced with `?? undefined` at the call site.
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
  /** Log label for the drift warning and the fail-loud transform error. */
  label: string;
  /** When false, `engineApi()` returns the raw native module unchanged. */
  isV2(): boolean;
  /** Requires the native module; loading semantics live at the call site. */
  loadNativeEngine(): NativeEngineModule;
  /** Per-run state storage (globalThis for next, closure for vite). */
  store: V2EngineStateStore;
  /** Passes paths absent from the last `analyze()` set through unchanged —
   *  the webpack loader hands over files outside the analysis universe. */
  passThroughUnknownPaths?: boolean;
  /** Refills empty sources before analyze: vite's HMR sends empty sources
   *  for unchanged files and the engine keeps no cache. Identity if omitted. */
  rehydrateFilesJson?(filesJsonRaw: string): string;
}

/**
 * Returns a function, invoked per call site, so `isV2()` and
 * `loadNativeEngine()` re-evaluate each time instead of being captured.
 */
export function createV2EngineApi(deps: V2EngineAdapterDeps): () => EngineApi {
  const { label, isV2, loadNativeEngine, store } = deps;
  return (): EngineApi => {
    if (!isV2()) {
      // SAFETY: the v1 leg IS the native module — `EngineApi` was derived from
      // the NAPI entry points it already exports.
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

        const sent = new Map<string, string>();
        for (const entry of parseFilesJson(filesJson, label)) {
          sent.set(entry.path, entry.source);
        }
        store.setSentSources(sent);

        // SAFETY: `emitterConfigJson` is animus's own wire with exactly these
        // three keys; dropping one silently rewires the runtime or css import.
        const emitterConfig = emitterConfigJson
          ? (JSON.parse(emitterConfigJson) as {
              runtime_import?: string;
              css_module_id?: string;
              system_props_module_id?: string;
            })
          : {};

        // Clear BEFORE constructing so a constructor throw cannot leave the
        // previous instance serving.
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
        // SAFETY: `native` is the loaded engine module, whose generated
        // `index.d.ts` declares `ExtractEngine` with exactly these methods.
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
        // Files outside the analysis universe: the stateful engine fails loud
        // on them, and unchanged is the correct output.
        const sentMap = store.getSentSources();
        if (deps.passThroughUnknownPaths && sentMap && !sentMap.has(path)) {
          return { code: source, hasComponents: false };
        }
        // The engine emits from analyze-time source, so drift surfaces once.
        const sent = sentMap?.get(path);
        if (sent !== undefined && sent !== source && !store.getDriftWarned()) {
          store.setDriftWarned(true);
          // eslint-disable-next-line no-console
          console.warn(
            `[${label}] v2: transform-time source for ${path} differs from analyze-time source — an upstream transform may be reverted`
          );
        }
        // SAFETY: serde output of the engine's own call on this line —
        // `transformFile` serializes `{code, hasComponents}`. Bad bytes throw.
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
