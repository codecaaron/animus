import { buildAnalyzeProjectArgs } from './analyze-project-args';
import { kitDescriptorDiagnostics } from './kit-descriptor';
import {
  collectSelectorAliasDiagnostics,
  effectiveLevel,
  knownDiagnosticCodes,
  surfaceManifestDiagnostics,
  systemLoadDiagnostics,
} from './manifest-diagnostics';
import { checkCustomProperties } from './property-diagnostics';
import { applyUnitFallback } from './unit-fallback';

import type { AnalyzeProjectInputs } from './analyze-project-args';
import type { KitDescriptorRecord } from './kit-descriptor';
import type {
  DiagnosticLevels,
  ManifestDiagnostic,
} from './manifest-diagnostics';
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
  /** What the host knows that the analysis cannot see. */
  analysisContext?: AnalysisContext;
  /** Diagnostics gathered outside analysis, surfaced through the same
   *  policy point as the manifest's own. */
  extraDiagnostics?: import('./manifest-diagnostics').ManifestDiagnostic[];
  /** The analysed kits' descriptors, which discovery read. */
  kitDescriptors?: readonly KitDescriptorRecord[];
}

/** What a host knows that the analysis cannot see. */
export interface AnalysisContext {
  /** rootDir-relative sources ingestion skipped. Their renders are unseen,
   *  so nothing is pruned while any is skipped, and an error from an option
   *  kept only for that reason is reported as a warning. */
  skippedSources?: string[];
  /** The bundler leaves an `import(expr)` it cannot read unbundled (Vite,
   *  Rollup, Turbopack), so the load reaches no analysed module. Omitted,
   *  it reaches the importer's directory, as a webpack context does. */
  unbundledComputedImports?: boolean;
  /** rootDir-relative directories of the analysed packages: a load into
   *  one reaches only its modules. */
  packageDirs?: string[];
  /** Those of them whose package is linked rather than installed, so
   *  development names their files where they are defined. */
  linkedDirs?: string[];
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
  const inputs: AnalyzeProjectInputs = {
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
    transformProvenanceJson: opts.system.transformProvenanceJson ?? null,
    // Without captured source manifests the correlation join can report
    // nothing, so the dirs are withheld and the engine skips the walk.
    externalDirsJson:
      opts.externalDirs?.length && hasSourceThemeManifests(opts.system)
        ? JSON.stringify(opts.externalDirs)
        : null,
  };
  // Present only for a theme with declaration scales, so a scalar system's
  // persisted inputs are unchanged.
  if (opts.system.declarationScalesJson) {
    inputs.declarationScalesJson = opts.system.declarationScalesJson;
  }
  // Present only when the host knows something, for the same reason.
  const context = opts.analysisContext;
  if (
    context?.skippedSources?.length ||
    context?.unbundledComputedImports ||
    context?.packageDirs?.length
  ) {
    inputs.analysisContextJson = JSON.stringify({
      skippedSources: context.skippedSources ?? [],
      unbundledComputedImports: context.unbundledComputedImports ?? false,
      packageDirs: context.packageDirs ?? [],
      linkedDirs: context.linkedDirs ?? [],
    });
  }
  return inputs;
}

function hasSourceThemeManifests(system: SystemConfig): boolean {
  // Absent, empty, and `{}` all mean: no module exported a built theme.
  const json = system.sourceThemeManifestsJson ?? '';
  return json.length > 0 && json !== '{}';
}

/** Systems whose load diagnostics were surfaced: each loaded system reports
 *  them once, not again on every analysis and hot update. The set is per
 *  process. Next's webpack compilers share one analysis in one process, but
 *  its build worker and Turbopack builds analyze in two processes, which
 *  repeat every diagnostic alike, component ones included. */
const surfacedSystems = new WeakSet<SystemConfig>();

/** The loaded system's own diagnostics, the first time it is analyzed. A
 *  strict error keeps failing every analysis until the system changes. */
function systemDiagnostics(
  system: SystemConfig,
  strict: boolean | undefined,
  levels: DiagnosticLevels | undefined
): ManifestDiagnostic[] {
  const diagnostics = [
    ...collectSelectorAliasDiagnostics(system.selectorAliasesJson),
    ...systemLoadDiagnostics(system),
  ];
  const blocking = diagnostics.some(
    (d) => effectiveLevel(d, { strict, levels }) === 'error'
  );
  if (surfacedSystems.has(system) && !blocking) return [];
  surfacedSystems.add(system);
  return diagnostics;
}

/**
 * The one analysis invocation both plugins share. Error handling stays at
 * the call site (strict-mode throw vs warn).
 */
export function runProjectAnalysis(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  engineApi: () => any,
  opts: AnalysisOptions & {
    warn: (message: string) => void;
    /** Receives info-severity diagnostics; pass a verbose-tier logger. */
    info?: (message: string) => void;
    strict?: boolean;
    /** The host's `diagnostics` option. */
    diagnostics?: DiagnosticLevels;
    /** A development session's error sink (`DiagnosticPolicy.reportErrors`). */
    reportErrors?: (message: string) => void;
  }
): ProjectAnalysisResult {
  const { analyzeProject, diagnosticCodes } = engineApi();

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
  // The system's errors, and a kit descriptor's this Animus cannot read,
  // join the manifest's on every analysis, so a build fails on them whatever
  // its strictness, and development reports them.
  const systemErrors = systemLoadDiagnostics(opts.system).filter(
    (diagnostic) => diagnostic.kind === 'error'
  );
  const kitDiagnostics = kitDescriptorDiagnostics(
    opts.kitDescriptors ?? [],
    manifest
  );
  if (systemErrors.length > 0 || kitDiagnostics.length > 0) {
    manifest.diagnostics = [
      ...systemErrors,
      ...kitDiagnostics,
      ...(manifest.diagnostics ?? []),
    ];
  }
  const componentCss = applyUnitFallback(manifest.css);
  const propertyDiagnostics = checkCustomProperties({
    system: opts.system,
    manifest,
    componentCss,
    globalCss: manifest.sheets.global,
  });
  surfaceManifestDiagnostics(manifest, opts.warn, {
    strict: opts.strict,
    info: opts.info,
    reportErrors: opts.reportErrors,
    levels: opts.diagnostics,
    knownCodes: opts.diagnostics
      ? knownDiagnosticCodes(diagnosticCodes?.())
      : undefined,
    prepend: [
      ...systemDiagnostics(opts.system, opts.strict, opts.diagnostics),
      ...propertyDiagnostics,
      ...(opts.extraDiagnostics ?? []),
    ],
  });
  const parseMs = Math.round(performance.now() - t);

  return {
    manifest,
    manifestJson,
    globalCss: manifest.sheets.global,
    componentCss,
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
