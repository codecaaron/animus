import { buildAnalyzeProjectArgs } from './analyze-project-args';
import { surfaceManifestDiagnostics } from './manifest-diagnostics';
import { applyUnitFallback } from './unit-fallback';

import type { AnalyzeProjectInputs } from './analyze-project-args';
import type { SystemConfig } from './system-config';

/**
 * Per-bundler emitter identity: where the runtime import comes from and
 * which module ids the Rust emitter injects into transformed sources.
 * Vite uses virtual module ids; Next uses on-disk `.animus/` paths.
 */
export interface EmitterConfig {
  runtimeImport: string;
  cssModuleId: string;
  systemPropsModuleId?: string;
}

export interface ProjectAnalysisResult {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  manifest: any;
  manifestJson: string;
  /** `manifest.sheets.global` — Rust-resolved global CSS. */
  globalCss: string;
  /** `manifest.css` with the shared unit fallback applied. */
  componentCss: string;
  /** The exact analyze-time inputs (already-serialized filesJson included) —
   *  reusable for persistence without re-serializing the source corpus. */
  inputs: AnalyzeProjectInputs;
  /** Sub-phase durations (ms) for verbose timing displays. */
  timings: { serializeMs: number; extractMs: number; parseMs: number };
}

export interface AnalysisOptions {
  fileEntries: Array<{ path: string; source: string; hash?: string }>;
  packageMap: Record<string, string>;
  system: SystemConfig;
  emitter: EmitterConfig;
  pathAliasesJson: string | null;
  /** Serialized staticCss forced-emission declarations, or null. */
  staticCssJson?: string | null;
  devMode: boolean;
}

/**
 * Build the named `analyzeProject` input set from analysis options. Also
 * the persistence shape for `.animus/analysis-inputs.json` — an isolated
 * process can replay the analysis from exactly this object
 * (spec: next-turbopack-integration).
 */
export function buildAnalysisInputs(
  opts: AnalysisOptions
): AnalyzeProjectInputs {
  return {
    filesJson: JSON.stringify(opts.fileEntries),
    scalesJson: opts.system.scalesJson,
    variableMapJson: opts.system.variableMapJson,
    contextualVarsJson: opts.system.contextualVarsJson,
    propConfigJson: opts.system.propConfigJson,
    groupRegistryJson: opts.system.groupRegistryJson,
    packageResolutionJson: JSON.stringify(opts.packageMap),
    devMode: opts.devMode,
    emitterConfigJson: JSON.stringify({
      runtime_import: opts.emitter.runtimeImport,
      css_module_id: opts.emitter.cssModuleId,
      ...(opts.emitter.systemPropsModuleId
        ? { system_props_module_id: opts.emitter.systemPropsModuleId }
        : {}),
    }),
    selectorAliasesJson: opts.system.selectorAliasesJson,
    globalStyleBlocksJson: opts.system.globalStyleBlocksJson,
    pathAliasesJson: opts.pathAliasesJson,
    keyframesJson: opts.system.keyframesJson,
    staticCssJson: opts.staticCssJson ?? null,
  };
}

/**
 * The one analysis invocation both plugins share: build the emitter
 * config, serialize inputs, call the NAPI `analyzeProject`, parse the
 * manifest, surface its diagnostics, and resolve the CSS outputs.
 *
 * Error handling stays at the call site (strict-mode throw vs warn).
 */
export function runProjectAnalysis(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  engineApi: () => any,
  opts: AnalysisOptions & { warn: (message: string) => void }
): ProjectAnalysisResult {
  const { analyzeProject } = engineApi();

  let t = performance.now();
  const inputs = buildAnalysisInputs(opts);
  const serializeMs = Math.round(performance.now() - t);

  t = performance.now();
  const manifestJson: string = analyzeProject(
    ...buildAnalyzeProjectArgs(inputs)
  );
  const extractMs = Math.round(performance.now() - t);

  t = performance.now();
  const manifest = JSON.parse(manifestJson);
  surfaceManifestDiagnostics(manifest, opts.warn);
  const parseMs = Math.round(performance.now() - t);

  return {
    manifest,
    manifestJson,
    globalCss: manifest?.sheets?.global || '',
    componentCss: applyUnitFallback(manifest?.css || ''),
    inputs,
    timings: { serializeMs, extractMs, parseMs },
  };
}

/**
 * Clear the engine's per-file analysis cache so stale results from a prior
 * build never bleed into a fresh run. Tolerates engines without the
 * capability (older builds) — the probe is benign.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function clearEngineCache(engineApi: () => any): void {
  try {
    const { clearAnalysisCache } = engineApi();
    clearAnalysisCache();
  } catch {
    // Benign optional-capability probe: nothing to clear on engines that
    // predate clearAnalysisCache.
  }
}
