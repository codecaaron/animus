import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createLogger, resolveConfig } from 'vite';
import { afterEach, describe, expect, test } from 'vitest';

import {
  disposeTempRoots,
  makeTempRoot,
} from '../../extract/tests/session/session-fixtures';
import { parserStoppingAt } from '../../extract/tests/source-ingestion-fixtures';
import { runBuildStart } from '../src/build-start';
import { applyResolvedConfig } from '../src/config';
import { PluginContext } from '../src/context';

import type { AnimusExtractOptions } from '../src/index';

const BROKEN = "export const Card = ds(.styles({}).asElement('section');\n";

afterEach(() => {
  disposeTempRoots();
});

/** A Vite start over one aborted file; an attempt that reaches analysis
 *  fails the test. */
async function startAborted(
  options: Omit<AnimusExtractOptions, 'system'>,
  command: 'build' | 'serve'
) {
  const root = realpathSync(makeTempRoot('animus-aborted-parse-gate-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'ds.ts'), 'export const ds = {};\n');
  writeFileSync(join(root, 'src', 'Card.ts'), BROKEN);
  const warnings: string[] = [];
  const customLogger = createLogger('silent');
  customLogger.warn = (message) => {
    warnings.push(message);
  };
  const ctx = new PluginContext({ system: './src/ds.ts', ...options }, () => ({
    loadSystemModule: () => ({
      propConfig: '{}',
      groupRegistry: '{}',
      scalesJson: '{}',
      variableMapJson: '{}',
      variableCss: '',
      dependencies: [],
    }),
    extractFacts: parserStoppingAt('ds(.'),
    analyzeProject: () => {
      throw new Error('an aborted attempt must not analyze');
    },
  }));
  applyResolvedConfig(
    ctx,
    await resolveConfig(
      { configFile: false, root, logLevel: 'silent', customLogger },
      command
    )
  );
  const start = () =>
    runBuildStart(ctx, async (specifier) => resolve(root, 'src', specifier));
  return { ctx, warnings, start };
}

describe('an aborted parse with no generation to keep', () => {
  test.each([undefined, false, true])(
    'fails a production build with strict %s, naming the file',
    async (strict) => {
      const { ctx, start } = await startAborted(
        strict === undefined ? {} : { strict },
        'build'
      );

      await expect(start()).rejects.toThrow(
        '[animus-extract] analysis not published: the parser stopped before the end of src/Card.ts (Unexpected token)'
      );
      expect(ctx.storedManifest).toBeNull();
    }
  );

  test('leaves a development server waiting for the repair', async () => {
    const { ctx, warnings, start } = await startAborted({}, 'serve');

    await start();

    expect([...ctx.abortedParseHashes.keys()]).toEqual(['src/Card.ts']);
    expect(ctx.storedManifest).toBeNull();
    expect(warnings.join('\n')).toContain('analysis not published');
  });
});
