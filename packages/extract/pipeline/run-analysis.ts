import { buildAnalyzeProjectArgs } from './analyze-project-args';
import {
  collectSelectorAliasDiagnostics,
  surfaceManifestDiagnostics,
} from './manifest-diagnostics';
import { applyUnitFallback } from './unit-fallback';

import type { AnalyzeProjectInputs } from './analyze-project-args';
import type { ProjectManifest } from './manifest-schema';
import type { SystemConfig } from './system-config';

/**
 * Per-bundler emitter identity: the module ids the engine injects into
 * transformed sources (Vite virtual ids; Next on-disk `.animus/` paths).
 */
export interface EmitterConfig {
  runtimeImport: string;
  cssModuleId: string;
  systemPropsModuleId?: string;
}

export interface ProjectAnalysisResult {
  manifest: ProjectManifest;
  manifestJson: string;
  globalCss: string;
  componentCss: string;
  /** The exact analyze-time inputs (serialized `filesJson` included) —
   *  persistable without re-serializing the source corpus. */
  inputs: AnalyzeProjectInputs;
  timings: { serializeMs: number; extractMs: number; parseMs: number };
}

export interface AnalysisOptions {
  fileEntries: Array<{ path: string; source: string; hash?: string }>;
  packageMap: Record<string, string>;
  system: SystemConfig;
  emitter: EmitterConfig;
  pathAliasesJson: string | null;
  /** Serialized `staticCss` forced-emission declarations. */
  staticCssJson?: string | null;
  /** rootDir-relative external package dirs (external-token candidates). */
  externalDirs?: string[];
  devMode: boolean;
  /** Diagnostics gathered outside analysis, surfaced through the same
   *  policy point as the manifest's own. */
  extraDiagnostics?: import('./manifest-diagnostics').ManifestDiagnostic[];
}

/**
 * The snake_case wire the engine deserializes; declaration order IS field
 * order. An absent `system_props_module_id` leaves the engine's default.
 */
type EmitterConfigWire = {
  runtime_import: string;
  css_module_id: string;
  system_props_module_id?: string;
};

/** The named `analyzeProject` input set, and the persistence shape an
 *  isolated process replays the analysis from. */
export function buildAnalysisInputs(
  opts: AnalysisOptions
): AnalyzeProjectInputs {
  const emitterConfig: EmitterConfigWire = {
    runtime_import: opts.emitter.runtimeImport,
    css_module_id: opts.emitter.cssModuleId,
  };
  if (opts.emitter.systemPropsModuleId) {
    emitterConfig.system_props_module_id = opts.emitter.systemPropsModuleId;
  }
  return {
    filesJson: JSON.stringify(opts.fileEntries),
    scalesJson: opts.system.scalesJson,
    variableMapJson: opts.system.variableMapJson,
    contextualVarsJson: opts.system.contextualVarsJson,
    propConfigJson: opts.system.propConfigJson,
    groupRegistryJson: opts.system.groupRegistryJson,
    packageResolutionJson: JSON.stringify(opts.packageMap),
    devMode: opts.devMode,
    emitterConfigJson: JSON.stringify(emitterConfig),
    selectorAliasesJson: opts.system.selectorAliasesJson,
    globalStyleBlocksJson: opts.system.globalStyleBlocksJson,
    pathAliasesJson: opts.pathAliasesJson,
    keyframesJson: opts.system.keyframesJson,
    staticCssJson: opts.staticCssJson ?? null,
    conditionAliasesJson: opts.system.conditionAliasesJson ?? null,
    transformSourcesJson: opts.system.transformSourcesJson ?? null,
    // Without captured source manifests the correlation join can report
    // nothing, so the dirs are withheld and the engine skips the walk.
    externalDirsJson:
      opts.externalDirs?.length && hasSourceThemeManifests(opts.system)
        ? JSON.stringify(opts.externalDirs)
        : null,
  };
}

function hasSourceThemeManifests(system: SystemConfig): boolean {
  // Absent, empty, and `{}` all mean: no module exported a built theme.
  const json = system.sourceThemeManifestsJson ?? '';
  return json.length > 0 && json !== '{}';
}

/**
 * The one analysis invocation both plugins share. Error handling stays at
 * the call site (strict-mode throw vs warn).
 */
export function runProjectAnalysis(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  engineApi: () => any,
  opts: AnalysisOptions & { warn: (message: string) => void; strict?: boolean }
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
  // SAFETY: `manifestJson` is this call's own `analyzeProject` return value,
  // the serde output `ProjectManifest` mirrors. Unparseable JSON throws.
  const manifest = JSON.parse(manifestJson) as ProjectManifest;
  surfaceManifestDiagnostics(manifest, opts.warn, {
    strict: opts.strict,
    prepend: [
      ...collectSelectorAliasDiagnostics(opts.system.selectorAliasesJson),
      ...(opts.extraDiagnostics ?? []),
    ],
  });
  const parseMs = Math.round(performance.now() - t);

  return {
    manifest,
    manifestJson,
    globalCss: manifest.sheets.global,
    componentCss: applyUnitFallback(manifest.css),
    inputs,
    timings: { serializeMs, extractMs, parseMs },
  };
}

/**
 * Clear the engine's per-file analysis cache so stale results never bleed
 * into a fresh run. Engines without the capability are tolerated.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function clearEngineCache(engineApi: () => any): void {
  try {
    const { clearAnalysisCache } = engineApi();
    clearAnalysisCache();
  } catch {
    // Nothing to clear on an engine without the capability.
  }
}
