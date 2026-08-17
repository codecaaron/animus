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
  /** The parsed engine manifest, typed by the producing package's own wire
   *  declaration (`manifest-schema.ts`) — consumers read it instead of
   *  re-deriving a private model per reader. */
  manifest: ProjectManifest;
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
  /** rootDir-relative external package dirs (external-token candidates). */
  externalDirs?: string[];
  devMode: boolean;
  /** System-level diagnostics gathered outside analysis (e.g. external
   *  keyframes discovery) — surfaced through the single shared policy
   *  point alongside the manifest's own. */
  extraDiagnostics?: import('./manifest-diagnostics').ManifestDiagnostic[];
}

/**
 * Build the named `analyzeProject` input set from analysis options. Also
 * the persistence shape for `.animus/analysis-inputs.json` — an isolated
 * process can replay the analysis from exactly this object
 * (spec: next-turbopack-integration).
 */
/**
 * `emitterConfigJson`'s wire shape: the snake_case spelling the Rust emitter
 * deserializes, distinct from the camelCase `EmitterConfig` above that names
 * the same identity on this side. Declaration order IS the serialized field
 * order, and an ABSENT `system_props_module_id` means this driver injects no
 * system-props module — the engine keeps its own default rather than emitting
 * an import of the empty string.
 */
type EmitterConfigWire = {
  runtime_import: string;
  css_module_id: string;
  system_props_module_id?: string;
};

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
    // The external-token candidate walk exists solely to feed the TS-side
    // correlation join, and that join can only report a candidate whose
    // token a SOURCE theme manifest defines. With no captured manifests
    // every candidate would be computed, serialized, and dropped — so the
    // dirs are withheld and the engine skips the walk entirely.
    externalDirsJson:
      opts.externalDirs?.length && hasSourceThemeManifests(opts.system)
        ? JSON.stringify(opts.externalDirs)
        : null,
  };
}

/** Whether the loader captured at least one source built-theme manifest. */
function hasSourceThemeManifests(system: SystemConfig): boolean {
  // Absent, null, empty, and the empty object all mean the same thing: the
  // loader evaluated no module exporting a built theme.
  const json = system.sourceThemeManifestsJson ?? '';
  return json.length > 0 && json !== '{}';
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
  // SAFETY: `manifestJson` is this call's own `analyzeProject` return value —
  // serde output from the Rust `AnalyzeResult` that `manifest-schema.ts`
  // mirrors. A parse failure throws here (the engine emitting unparseable
  // JSON is an engine bug, not a recoverable input); a Rust-side field rename
  // is caught by the manifest tether test in `packages/_integration`.
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
