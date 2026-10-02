import { createLogger } from 'vite';
import { describe, expect, test } from 'vitest';

import {
  abortedFacts,
  factsExtractor,
} from '../../extract/tests/source-ingestion-fixtures';
import { PluginContext } from '../src/context';

import type { AnimusExtractOptions } from '../src/index';

const BROKEN = "export const Card = ds(.styles({}).asElement('section');\n";

/** One aborted file; an attempt that reaches analysis fails the test. */
function abortedContext(
  options: AnimusExtractOptions,
  warnings: string[] = []
): PluginContext {
  const ctx = new PluginContext(options, () => ({
    extractFacts: factsExtractor({
      'src/Card.ts': abortedFacts('src/Card.ts'),
    }),
    analyzeProject: () => {
      throw new Error('an aborted attempt must not analyze');
    },
  }));
  const logger = createLogger('silent');
  logger.warn = (message) => {
    warnings.push(message);
  };
  ctx.logger = logger;
  return ctx;
}

const analyzeBroken = (ctx: PluginContext) =>
  ctx.analyzeIngested({
    rawEntries: [{ path: 'src/Card.ts', source: BROKEN }],
  });

describe('an aborted parse with no generation to keep', () => {
  test.each([undefined, false, true])(
    'fails a production build with strict %s, naming the file',
    async (strict) => {
      const options: AnimusExtractOptions = { system: './src/ds.ts' };
      if (strict !== undefined) options.strict = strict;
      const ctx = abortedContext(options);
      ctx.isProd = true;

      await expect(analyzeBroken(ctx)).rejects.toThrow(
        '[animus-extract] analysis not published: the parser stopped before the end of src/Card.ts (Unexpected token)'
      );
      expect(ctx.storedManifest).toBeNull();
    }
  );

  test('leaves a development server waiting for the repair', async () => {
    const warnings: string[] = [];
    const ctx = abortedContext({ system: './src/ds.ts' }, warnings);

    const result = await analyzeBroken(ctx);

    expect(result.ok).toBe(false);
    expect([...(result.abortedOriginals?.keys() ?? [])]).toEqual([
      'src/Card.ts',
    ]);
    expect(ctx.storedManifest).toBeNull();
    expect(warnings.join('\n')).toContain('analysis not published');
  });
});
