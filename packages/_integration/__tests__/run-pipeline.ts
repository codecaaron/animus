/**
 * Shared pipeline helper for integration tests.
 *
 * Drives the stateful v2 `ExtractEngine` through the SAME adapter both
 * production plugins use — `createV2EngineApi` from
 * `@animus-ui/extract/pipeline` — with the per-run engine handle kept in
 * closure variables (the vite-plugin's storage shape). Analysis inputs are
 * named (`AnalyzeProjectInputs`) and serialized into the positional NAPI tuple
 * by the production `buildAnalyzeProjectArgs`, so this helper cannot drift
 * from the engine's slot list: a new engine input arrives here as a new named
 * field. Same code path as the vite-plugin, minus file discovery and
 * subprocess.
 */
import {
  applyUnitFallback,
  buildAnalyzeProjectArgs,
  createV2EngineApi,
} from '@animus-ui/extract/pipeline';

import { config, theme } from '../fixtures/setup';

import type {
  AnalyzeProjectInputs,
  V2ExtractEngine,
} from '@animus-ui/extract/pipeline';
import type { KeyframeFrameMap } from '@animus-ui/system';

/**
 * One entry of a `keyframes()` collection's `__frames` payload: the resolved
 * `@keyframes` identifier plus its frame body. Frame bodies keep the system
 * package's own vocabulary (`KeyframeFrameMap`) rather than a restatement.
 */
export interface KeyframesCollectionEntry {
  name: string;
  frames: KeyframeFrameMap;
}

/**
 * The decoded form of the `keyframesJson` analysis input —
 * `{ exportName: { keyName: { name, frames } } }`, which is what
 * `system_loader::extract_keyframes_blocks` produces and what the engine
 * parses back into its binding registry. Declared once here, beside the helper
 * that serializes it, so the two suites that build this payload cannot drift
 * from each other.
 */
export type KeyframesBlocks = {
  [exportName: string]: { [keyName: string]: KeyframesCollectionEntry };
};

// Direct-path require of the v2 loader per the _integration NAPI-loading
// contract (see CLAUDE.md): index-v2.js is the package's only engine and its
// root entry. Package-specifier resolution is forbidden here.
const native = require('../../extract/index-v2.js');

let engine: V2ExtractEngine | null = null;
let sentSources: Map<string, string> | null = null;
let driftWarned = false;

/** The production engine adapter, storing per-run state in closure variables
 *  exactly as the vite-plugin does. */
const engineApi = createV2EngineApi({
  label: 'animus-integration',
  isV2: () => true,
  loadNativeEngine: () => native,
  store: {
    getEngine: () => engine,
    setEngine: (next) => {
      engine = next;
    },
    getSentSources: () => sentSources,
    setSentSources: (next) => {
      sentSources = next;
    },
    getDriftWarned: () => driftWarned,
    setDriftWarned: (value) => {
      driftWarned = value;
    },
  },
});

/**
 * The fixture-derived analysis inputs every integration call shares. Every
 * optional engine input defaults to `null`: the integration fixtures declare
 * no selector aliases, global blocks, path aliases, keyframes, forced static
 * CSS, condition aliases, external package dirs or package-shipped transform
 * sources, and the emitter identity is a bundler concern with no analog here.
 * Call sites override exactly the inputs their case exercises.
 */
function fixtureInputs(filesJson: string): AnalyzeProjectInputs {
  return {
    filesJson,
    scalesJson: theme.scalesJson,
    variableMapJson: theme.variableMapJson,
    contextualVarsJson: theme.contextualVarsJson || null,
    propConfigJson: config.propConfig,
    groupRegistryJson: config.groupRegistry,
    packageResolutionJson: '{}',
    devMode: false,
    emitterConfigJson: null,
    selectorAliasesJson: null,
    globalStyleBlocksJson: null,
    pathAliasesJson: null,
    keyframesJson: null,
    staticCssJson: null,
    conditionAliasesJson: null,
    externalDirsJson: null,
    transformSourcesJson: null,
  };
}

/**
 * Analyze `filesJson` with the shared fixture inputs, overridden by the
 * inputs under test. Returns the manifest JSON.
 */
export function analyzeProject(
  filesJson: string,
  overrides: Partial<AnalyzeProjectInputs> = {}
): string {
  return engineApi().analyzeProject(
    ...buildAnalyzeProjectArgs({ ...fixtureInputs(filesJson), ...overrides })
  );
}

/** Reset retained engine state (v2 `ExtractEngine.clearCache`). */
export function clearAnalysisCache(): void {
  engineApi().clearAnalysisCache();
}

export function runPipeline(
  fileEntries: Array<{ path: string; source: string }>,
  options: { devMode?: boolean } = {}
) {
  // Mirrors the production plugins' analysis inputs — including
  // `selectorAliasesJson` so integration coverage exercises selector-alias
  // processing.
  //
  // `options.devMode` toggles the engine's `devMode` — defaults to false
  // (production semantics). Pass true to exercise the prospective-elimination
  // path required by the `css-reconciler` dev/build parity contract.
  const manifestJson = analyzeProject(JSON.stringify(fileEntries), {
    devMode: options.devMode ?? false,
    selectorAliasesJson: config.selectorAliases,
  });

  const manifest = JSON.parse(manifestJson);
  const css = applyUnitFallback(manifest.css || '');

  return { manifest, css };
}
