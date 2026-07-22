import {
  buildAnalyzeProjectArgs,
  createV2EngineApi,
} from '@animus-ui/extract/pipeline';
import { readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

import { transformWithManifest } from './loader-core';

import type { LoaderPolicyOptions } from './loader-core';
import type {
  AnalyzeProjectInputs,
  V2ExtractEngine,
} from '@animus-ui/extract/pipeline';

type LoaderContext = {
  resourcePath: string;
  rootContext: string;
  getOptions: () => LoaderPolicyOptions & { rootDir?: string };
};

// Worker-local engine state. Turbopack executes JS loaders in isolated,
// ephemeral worker processes — module scope IS worker scope, and nothing
// here is (or may be) shared across files beyond this process
// (spec: next-turbopack-integration / Stateless per-file transformation).
// The singleton module must never be imported from this graph.
let engine: V2ExtractEngine | null = null;
let sentSources: Map<string, string> | null = null;
let driftWarned = false;
let hydratedKey: string | null = null;
let hydratedManifestJson: string | null = null;
let hydrateFailedWarned = false;

// Indirect module id keeps the require dynamic under bundling.
const engineModuleId = '@animus-ui/extract';
const engineApi = createV2EngineApi({
  label: 'animus-next-turbopack',
  isV2: () => true,
  loadNativeEngine: () => require(engineModuleId),
  // Generated .animus/* modules and other files outside the analysis
  // universe pass through unchanged, matching the webpack loader.
  passThroughUnknownPaths: true,
  store: {
    getEngine: () => engine,
    setEngine: (next) => {
      engine = next;
    },
    getSentSources: () => sentSources,
    setSentSources: (sources) => {
      sentSources = sources;
    },
    getDriftWarned: () => driftWarned,
    setDriftWarned: (value) => {
      driftWarned = value;
    },
  },
});

/**
 * Hydrate this worker's engine from the `.animus/` artifact pair — the v2
 * engine serves transforms only from analyze-retained state, so a fresh
 * worker replays the persisted analysis inputs once (and again whenever
 * either artifact changes; keyed by mtime+size of both). The persisted
 * manifest is a hard prerequisite (spec: next-turbopack-integration /
 * Stateless per-file transformation — absent or unreadable
 * `.animus/manifest.json` means passthrough, even when analysis inputs
 * exist). Returns the manifest JSON, or null (caller passes through).
 */
function hydrate(rootDir: string): string | null {
  const inputsPath = join(rootDir, '.animus', 'analysis-inputs.json');
  const manifestPath = join(rootDir, '.animus', 'manifest.json');

  let inputsStat: { mtimeNs: bigint; size: bigint };
  let manifestStat: { mtimeNs: bigint; size: bigint };
  try {
    // bigint stat: nanosecond mtime closes the same-millisecond rewrite
    // window that mtimeMs-granularity keys can miss. The paths are part of
    // the key so one worker serving two roots can never cross-serve.
    inputsStat = statSync(inputsPath, { bigint: true });
    manifestStat = statSync(manifestPath, { bigint: true });
  } catch {
    return null; // artifact set incomplete — passthrough
  }

  const key =
    `${inputsPath}:${inputsStat.mtimeNs}:${inputsStat.size}` +
    `:${manifestStat.mtimeNs}:${manifestStat.size}`;
  if (key === hydratedKey && hydratedManifestJson !== null) {
    return hydratedManifestJson;
  }

  try {
    // The persisted manifest must parse before analysis is replayed — a
    // torn or corrupt artifact passes through instead of half-transforming.
    // The replayed manifest (spec-pinned equal to the persisted one) is what
    // transforms consume, staying consistent with the engine's retained state.
    JSON.parse(readFileSync(manifestPath, 'utf-8'));
    const inputs = JSON.parse(
      readFileSync(inputsPath, 'utf-8')
    ) as AnalyzeProjectInputs;
    const { analyzeProject } = engineApi();
    hydratedManifestJson = analyzeProject(...buildAnalyzeProjectArgs(inputs));
    hydratedKey = key;
    return hydratedManifestJson;
  } catch (e: unknown) {
    if (!hydrateFailedWarned) {
      hydrateFailedWarned = true;
      console.warn(
        `[animus-extract] Turbopack worker hydration failed (${String(e)}); sources pass through untransformed`
      );
    }
    return null;
  }
}

/**
 * Turbopack loader for Animus source transformation. Derives everything
 * from the incoming source, its JSON-serializable options, and the
 * `.animus/` disk artifacts written by the out-of-band orchestrator.
 */
export default function animusTurbopackLoader(
  this: LoaderContext,
  source: string
): string {
  const opts = this.getOptions?.() ?? {};
  const rootDir = opts.rootDir ?? this.rootContext;

  const manifestJson = hydrate(rootDir);
  if (!manifestJson) return source;

  const filename = relative(rootDir, this.resourcePath);
  return transformWithManifest({
    source,
    filename,
    manifestJson,
    engineApi,
    opts,
  });
}
