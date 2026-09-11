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

export interface KeyframesCollectionEntry {
  name: string;
  frames: KeyframeFrameMap;
}

/**
 * The decoded `keyframesJson` analysis input, mirroring what the Rust
 * `extract_keyframes_blocks` emits and the engine parses back.
 */
export type KeyframesBlocks = {
  [exportName: string]: { [keyName: string]: KeyframesCollectionEntry };
};

// Direct file path, never a package specifier: `createRequire` resolution can
// pick the `types` condition and load a `.d.ts`, leaving exports undefined.
const native = require('../../extract/index-v2.js');

let engine: V2ExtractEngine | null = null;
let sentSources: Map<string, string> | null = null;
let driftWarned = false;

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

/** Analyzes with the shared fixture inputs; returns the manifest JSON. */
export function analyzeProject(
  filesJson: string,
  overrides: Partial<AnalyzeProjectInputs> = {}
): string {
  return engineApi().analyzeProject(
    ...buildAnalyzeProjectArgs({ ...fixtureInputs(filesJson), ...overrides })
  );
}

export function clearAnalysisCache(): void {
  engineApi().clearAnalysisCache();
}

export function runPipeline(
  fileEntries: Array<{ path: string; source: string }>,
  options: { devMode?: boolean } = {}
) {
  const manifestJson = analyzeProject(JSON.stringify(fileEntries), {
    devMode: options.devMode ?? false,
    selectorAliasesJson: config.selectorAliases,
  });

  const manifest = JSON.parse(manifestJson);
  const css = applyUnitFallback(manifest.css || '');

  return { manifest, css };
}
