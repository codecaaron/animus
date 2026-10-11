import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createLogger, resolveConfig } from 'vite';
import { afterEach, describe, expect, test } from 'vitest';

import {
  disposeTempRoots,
  makeTempRoot,
} from '../../extract/tests/session/session-fixtures';
import { factsExtractor } from '../../extract/tests/source-ingestion-fixtures';
import { runBuildStart } from '../src/build-start';
import { applyResolvedConfig } from '../src/config';
import { PluginContext } from '../src/context';
import { makeManifest } from './manifest-fixture';

const ANALYSIS_CONTEXT_SLOT = 20;

interface AnalysisContextWire {
  unbundledComputedImports?: boolean;
}

afterEach(() => {
  disposeTempRoots();
});

/** A Vite production build; the analysis contexts the engine received. */
async function productionBuild() {
  const root = realpathSync(makeTempRoot('animus-skipped-sources-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'ds.ts'), 'export const ds = {};\n');
  writeFileSync(
    join(root, 'src', 'App.tsx'),
    'export const App = () => <R size="sm" />;\n'
  );
  const contexts: AnalysisContextWire[] = [];
  const ctx = new PluginContext({ system: './src/ds.ts' }, () => ({
    loadSystemModule: () => ({
      propConfig: '{}',
      groupRegistry: '{}',
      scalesJson: '{}',
      variableMapJson: '{}',
      variableCss: '',
      dependencies: [],
    }),
    extractFacts: factsExtractor({}),
    analyzeProject: (...args: unknown[]) => {
      // SAFETY: the context slot holds the host's own JSON.stringify output,
      // or nothing when the host knows nothing.
      const json = args[ANALYSIS_CONTEXT_SLOT] as string | undefined;
      // SAFETY: as above, the context's wire shape.
      contexts.push(JSON.parse(json ?? '{}') as AnalysisContextWire);
      return JSON.stringify(makeManifest());
    },
  }));
  applyResolvedConfig(
    ctx,
    await resolveConfig(
      {
        configFile: false,
        root,
        logLevel: 'silent',
        customLogger: createLogger('silent'),
      },
      'build'
    )
  );
  await runBuildStart(ctx, async (specifier) => resolve(root, specifier));
  return { contexts };
}

describe('a production build', () => {
  test('tells the engine Rollup leaves a computed import() unbundled', async () => {
    const { contexts } = await productionBuild();
    expect(contexts[0]?.unbundledComputedImports).toBe(true);
  });
});
