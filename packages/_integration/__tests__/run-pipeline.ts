import {
  applyUnitFallback,
  buildAnalyzeProjectArgs,
  createV2EngineApi,
} from '@animus-ui/extract/pipeline';

import { config, theme } from '../fixtures/setup';

import type {
  AnalyzeProjectInputs,
  ProjectManifest,
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

/** Transforms one file of the most recent analysis. */
export function transformFile(path: string, source: string) {
  return engineApi().transformFile(source, path, '');
}

/** `code` with each reference to shared system-props data replaced by the
 *  value it names, as the runtime reads it: a table,
 *  `animusTables.<table>["<key>"]`; a prop-name list, `systemPropNames_<key>`
 *  (one with groups reads `systemPropGroups`); the `supersededBy` table. */
export function inlineTables(manifest: ProjectManifest, code: string): string {
  const tables = manifest.runtime_tables;
  const lists = manifest.prop_name_lists ?? {};
  const shared = code
    .replace(/\bsystemPropNames_([0-9a-f]{8})\b/g, (reference, key: string) => {
      const list = lists[key];
      if (list === undefined)
        throw new Error(`no shared list for ${reference}`);
      const names = JSON.stringify(list.names ?? []);
      return list.groups?.length
        ? `[].concat(${[...list.groups.map((g) => `systemPropGroups.${g}`), names].join(',')})`
        : names;
    })
    .replace(
      /:supersededBy\b/g,
      `:${JSON.stringify(manifest.superseded_by ?? {})}`
    );
  return shared.replace(
    /animusTables\.(scaleValues|keywords|declarationScaleValues)\[("(?:[^"\\]|\\.)*")\]/g,
    (reference, table: string, literal: string) => {
      const key = String(JSON.parse(literal));
      const value =
        table === 'scaleValues'
          ? tables?.scaleValues[key]
          : table === 'keywords'
            ? tables?.keywords[key]
            : tables?.declarationScaleValues[key];
      if (value === undefined)
        throw new Error(`no shared table for ${reference}`);
      return JSON.stringify(value);
    }
  );
}

export function clearAnalysisCache(): void {
  engineApi().clearAnalysisCache();
}

export function runPipeline(
  fileEntries: Array<{ path: string; source: string }>,
  options: { devMode?: boolean; inputs?: Partial<AnalyzeProjectInputs> } = {}
) {
  const manifestJson = analyzeProject(JSON.stringify(fileEntries), {
    devMode: options.devMode ?? false,
    selectorAliasesJson: config.selectorAliases,
    ...options.inputs,
  });

  const manifest = JSON.parse(manifestJson);
  const css = applyUnitFallback(manifest.css || '');

  return { manifest, css };
}
