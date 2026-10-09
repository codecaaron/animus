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

/** A production build over the real ingestion (MDX compiles for real); the
 *  engine double records whether each analysis may prune. */
async function productionBuild(rawEntries: Array<typeof APP>) {
  const prunes: boolean[] = [];
  const warnings: string[] = [];
  const ctx = new PluginContext({ system: './src/ds.ts' }, () => ({
    extractFacts: factsExtractor({}),
    analyzeProject: (...args: unknown[]) => {
      prunes.push(args[DEV_MODE_SLOT] === false);
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
  return { ok: result.ok, prunes, warned: warnings.join('\n') };
}

describe('a production build with a skipped source', () => {
  test('prunes when nothing is skipped', async () => {
    const { ok, prunes } = await productionBuild([APP]);
    expect(ok).toBe(true);
    expect(prunes).toEqual([true]);
  });

  test('prunes nothing, and the warning says so', async () => {
    const { ok, prunes, warned } = await productionBuild([APP, BROKEN_MDX]);
    expect(ok).toBe(true);
    expect(prunes).toEqual([false]);
    expect(warned).toContain('SOURCE_MDX_PARSE_ERROR src/Doc.mdx');
    expect(warned).toContain('its renders are not seen, so nothing is pruned');
  });
});
