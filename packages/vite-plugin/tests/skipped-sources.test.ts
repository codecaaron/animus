import { createLogger } from 'vite';
import { describe, expect, test } from 'vitest';

import { factsExtractor } from '../../extract/tests/source-ingestion-fixtures';
import { PluginContext } from '../src/context';
import { makeManifest } from './manifest-fixture';

const APP = {
  path: 'src/App.tsx',
  source: 'export const App = () => <R size="sm" />;\n',
};

/** Renders an option, but does not compile: the `<R>` is never closed. */
const BROKEN_MDX = {
  path: 'src/Doc.mdx',
  source: `import { R } from './R';\n\n<R size="lg">\n`,
};

const DEV_MODE_SLOT = 7;
const ANALYSIS_CONTEXT_SLOT = 20;

interface AnalysisContextWire {
  skippedSources?: string[];
  unbundledComputedImports?: boolean;
}

/** A production build over the real ingestion (MDX compiles for real); the
 *  engine double records whether each analysis may prune, and what the
 *  host told it. */
async function productionBuild(rawEntries: Array<typeof APP>) {
  const prunes: boolean[] = [];
  const contexts: AnalysisContextWire[] = [];
  const warnings: string[] = [];
  const ctx = new PluginContext({ system: './src/ds.ts' }, () => ({
    extractFacts: factsExtractor({}),
    analyzeProject: (...args: unknown[]) => {
      // SAFETY: the context slot holds the host's own JSON.stringify output,
      // or nothing when the host knows nothing.
      const json = args[ANALYSIS_CONTEXT_SLOT] as string | undefined;
      // SAFETY: as above, the context's wire shape.
      const context = JSON.parse(json ?? '{}') as AnalysisContextWire;
      contexts.push(context);
      prunes.push(
        args[DEV_MODE_SLOT] === false &&
          (context.skippedSources ?? []).length === 0
      );
      return JSON.stringify(makeManifest());
    },
  }));
  ctx.isProd = true;
  ctx.emissionProd = true;
  const logger = createLogger('silent');
  logger.warn = (message) => {
    warnings.push(message);
  };
  ctx.logger = logger;
  const result = await ctx.analyzeIngested({ rawEntries });
  return { ok: result.ok, prunes, contexts, warned: warnings.join('\n') };
}

describe('a production build with a skipped source', () => {
  test('prunes when nothing is skipped', async () => {
    const { ok, prunes } = await productionBuild([APP]);
    expect(ok).toBe(true);
    expect(prunes).toEqual([true]);
  });

  test('prunes nothing, and the warning says so', async () => {
    const { ok, prunes, contexts, warned } = await productionBuild([
      APP,
      BROKEN_MDX,
    ]);
    expect(ok).toBe(true);
    expect(prunes).toEqual([false]);
    expect(contexts[0]?.skippedSources).toEqual(['src/Doc.mdx']);
    expect(warned).toContain('SOURCE_MDX_PARSE_ERROR src/Doc.mdx');
    expect(warned).toContain('its renders are not seen, so nothing is pruned');
  });

  test('tells the engine Rollup leaves a computed import() unbundled', async () => {
    const { contexts } = await productionBuild([APP]);
    expect(contexts[0]?.unbundledComputedImports).toBe(true);
  });
});
