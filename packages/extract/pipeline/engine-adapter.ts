/**
 * One engine API for both plugins. Imports neither the native binding nor any
 * plugin or bundler — every such dependency arrives injected.
 */

import { parseInternalWire } from './internal-wire';
import { parseFilesJson } from './source-ingestion';

import type { ListedLoad } from './host-expansions';
import type { ProbeEvidenceGatherer } from './probe-evidence';
import type { PreparedPackage } from './registry-packages';
import type {
  EngineOptions,
  ExtractEngine,
  NativeModule,
} from '@animus-ui/extract';

/** The stateful engine handle produced by `new native.ExtractEngine(...)`. */
export type ExtractorEngine = Pick<
  ExtractEngine,
  | 'prepare'
  | 'analyzePrepared'
  | 'fullManifestJson'
  | 'analysisTimings'
  | 'transformFile'
  | 'clearCache'
>;

/** The native functions the engine API passes through, as the engine
 *  declares them. */
type NativeFunctions = Pick<
  NativeModule,
  | 'loadSystemModule'
  | 'extractFacts'
  | 'extractModuleFacts'
  | 'packageLoads'
  | 'moduleSpecifiers'
  | 'systemMembership'
  | 'engineBuildId'
  | 'diagnosticCodes'
  | 'resolveSpecifier'
  | 'fingerprintFile'
  | 'fingerprintBytes'
  | 'declaresKitSource'
  | 'locatePackage'
  | 'resolveKitSourceRoot'
>;

export interface TransformFileResult {
  code: string;
  hasComponents: boolean;
  /** Present on a file with no component whose builder chains the transform
   *  marked `/* @__PURE__ *\/`: `code` is the source with those marks. */
  annotated?: true;
}

/**
 * `analyzeProject` takes its arguments positionally to mirror the NAPI
 * contract, so argument order is part of the contract.
 */
export interface EngineApi extends NativeFunctions {
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
    transformSourcesJson: string | null,
    transformProvenanceJson?: string | null,
    declarationScalesJson?: string,
    analysisContextJson?: string,
    generatedNamesJson?: string,
    propertyRecordsJson?: string,
    positionTryJson?: string,
    viewTransitionsJson?: string,
    /** Given, the session's evidence for the bases and computed loads the
     *  engine's `prepare` names, carrying its input identity (spec §2.2
     *  A2, A8, §6.3), as JSON. */
    probeEvidence?: ProbeEvidenceGatherer
  ) => string;
  transformFile: (
    source: string,
    path: string,
    manifest: string
  ) => TransformFileResult;
  clearAnalysisCache: () => void;
  /** The last `analyzeProject`'s full manifest, every section, which a
   *  persisted manifest artifact and tooling read. Absent, `analyzeProject`
   *  returns the full manifest itself. */
  fullManifestJson?: () => string;
  /** The last `analyzeProject`'s engine phases, in ms, as a JSON object in
   *  phase order (`cssResolution` among them). Absent, none are reported. */
  analysisTimings?: () => string;
}

/**
 * Per-run storage for the engine instance, the analyze-time sources drift
 * detection compares against, and the one-shot drift flag.
 */
export interface EngineStateStore {
  getEngine(): ExtractorEngine | null;
  setEngine(engine: ExtractorEngine | null): void;
  getSentSources(): Map<string, string> | null;
  setSentSources(sources: Map<string, string> | null): void;
  getDriftWarned(): boolean;
  setDriftWarned(value: boolean): void;
}

/** The native engine module the adapter reads. */
export interface NativeEngineModule extends NativeFunctions {
  ExtractEngine: new (options?: EngineOptions) => ExtractorEngine;
}

export interface EngineAdapterDeps {
  /** Log label for the drift warning and the fail-loud transform error. */
  label: string;
  /** Requires the native module; loading semantics live at the call site. */
  loadNativeEngine(): NativeEngineModule;
  /** Per-run state storage (globalThis for next, closure for vite). */
  store: EngineStateStore;
  /** Passes paths absent from the last `analyze()` set through unchanged —
   *  the webpack loader hands over files outside the analysis universe. */
  passThroughUnknownPaths?: boolean;
  /** Refills empty sources before analyze: vite's HMR sends empty sources
   *  for unchanged files and the engine keeps no cache. Identity if omitted. */
  rehydrateFilesJson?(filesJsonRaw: string): string;
}

/**
 * Returns a function, invoked per call site, so `loadNativeEngine()`
 * re-evaluates each time instead of being captured.
 */
export function createEngineApi(deps: EngineAdapterDeps): () => EngineApi {
  const { label, loadNativeEngine, store } = deps;
  return (): EngineApi => {
    const native = loadNativeEngine();
    return {
      loadSystemModule: native.loadSystemModule,
      extractFacts: native.extractFacts,
      extractModuleFacts: native.extractModuleFacts,
      packageLoads: native.packageLoads,
      moduleSpecifiers: native.moduleSpecifiers,
      systemMembership: native.systemMembership,
      diagnosticCodes: native.diagnosticCodes,
      engineBuildId: native.engineBuildId,
      resolveSpecifier: native.resolveSpecifier,
      fingerprintFile: native.fingerprintFile,
      fingerprintBytes: native.fingerprintBytes,
      declaresKitSource: native.declaresKitSource,
      locatePackage: native.locatePackage,
      resolveKitSourceRoot: native.resolveKitSourceRoot,
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
        transformSourcesJson,
        transformProvenanceJson,
        declarationScalesJson,
        analysisContextJson,
        generatedNamesJson,
        propertyRecordsJson,
        positionTryJson,
        viewTransitionsJson,
        probeEvidence
      ) => {
        const filesJson = deps.rehydrateFilesJson
          ? deps.rehydrateFilesJson(filesJsonRaw)
          : filesJsonRaw;

        const priorEngine = store.getEngine();
        const priorSent = store.getSentSources();
        const sent = new Map<string, string>();
        for (const entry of parseFilesJson(filesJson, label)) {
          sent.set(entry.path, entry.source);
        }
        store.setSentSources(sent);

        // SAFETY: `emitterConfigJson` is animus's own wire with exactly these
        // keys; dropping one silently rewires the runtime or css import, or
        // the class names.
        const emitterConfig = emitterConfigJson
          ? (JSON.parse(emitterConfigJson) as {
              runtime_import?: string;
              css_module_id?: string;
              system_props_module_id?: string;
              short_class_prefix?: string;
              slot_provenance?: boolean;
            })
          : {};

        // Clear BEFORE constructing so a constructor throw cannot leave the
        // previous instance serving.
        store.setEngine(null);

        const config: EngineOptions = {
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
          transformProvenanceJson: transformProvenanceJson ?? undefined,
          declarationScalesJson,
          analysisContextJson,
          generatedNamesJson,
          propertyRecordsJson,
          positionTryJson,
          viewTransitionsJson,
          shortClassPrefix: emitterConfig.short_class_prefix,
          slotProvenance: emitterConfig.slot_provenance,
          devMode,
        };
        const engine = new native.ExtractEngine(config);
        store.setEngine(engine);
        // The session answers the probes the parse names, and analysis
        // reads that parse, so the files cross once.
        const preparedJson = engine.prepare(filesJson);
        if (probeEvidence === undefined) return engine.analyzePrepared();
        const prepared = parseInternalWire<{
          identity: string;
          bases: string[];
          loads: ListedLoad[];
          packages: PreparedPackage[];
        }>(preparedJson, 'ExtractEngine.prepare');
        let evidence: string;
        try {
          evidence = probeEvidence(
            prepared.bases,
            prepared.identity,
            prepared.loads,
            prepared.packages
          );
        } catch (error) {
          // A gatherer that refuses this input leaves the analysis that
          // last ran serving.
          store.setEngine(priorEngine);
          store.setSentSources(priorSent);
          throw error;
        }
        return engine.analyzePrepared(evidence);
      },
      transformFile: (source, path, _manifest) => {
        const engine = store.getEngine();
        if (!engine) {
          throw new Error(
            `[${label}] extractor transform before analyze — engine instance not initialized`
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
            `[${label}] extractor: transform-time source for ${path} differs from analyze-time source — an upstream transform may be reverted`
          );
        }
        // SAFETY: serde output of the engine's own call on this line —
        // `transformFile` serializes `{code, hasComponents, annotated?}`. Bad
        // bytes throw.
        const result = JSON.parse(
          engine.transformFile(path)
        ) as TransformFileResult;
        // Pure marks are only a size gain: a drifted system module is served
        // as the host has it, never reverted to analyze-time bytes.
        if (result.annotated && sent !== undefined && sent !== source) {
          return { code: source, hasComponents: false };
        }
        return result;
      },
      fullManifestJson: () => {
        const engine = store.getEngine();
        if (!engine) {
          throw new Error(
            `[${label}] extractor fullManifestJson before analyze — engine instance not initialized`
          );
        }
        return engine.fullManifestJson();
      },
      analysisTimings: () => store.getEngine()?.analysisTimings() ?? '{}',
      clearAnalysisCache: () => {
        const engine = store.getEngine();
        if (engine) engine.clearCache();
        store.setEngine(null);
      },
    };
  };
}
