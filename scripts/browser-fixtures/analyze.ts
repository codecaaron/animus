/**
 * A fixture project analyzed by the built extraction engine (`vp run
 * build:extractor`), as a host runs it, for cases that render real output.
 */
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildAnalyzeProjectArgs,
  createEngineApi,
} from '../../packages/extract/pipeline/index';

import type { ExtractorEngine } from '../../packages/extract/pipeline/index';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);

export interface FixtureProject {
  path: string;
  source: string;
  theme: {
    scalesJson: string;
    variableMapJson: string;
    contextualVarsJson?: string | null;
  };
  config: { propConfig: string; groupRegistry: string };
}

/** The analysis manifest of `project`'s one file. */
export function analyzeFixture({
  path,
  source,
  theme,
  config,
}: FixtureProject) {
  let engine: ExtractorEngine | null = null;
  let sentSources: Map<string, string> | null = null;
  let driftWarned = false;
  const engineApi = createEngineApi({
    label: 'browser-fixtures',
    loadNativeEngine: () =>
      require(resolve(ROOT, 'packages', 'extract', 'extractor.js')),
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
  const manifestJson: string = engineApi().analyzeProject(
    ...buildAnalyzeProjectArgs({
      filesJson: JSON.stringify([{ path, source }]),
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
    })
  );
  return JSON.parse(manifestJson);
}
