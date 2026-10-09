import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createLogger } from 'vite';
import { afterEach, describe, expect, test } from 'vitest';

import {
  createKitWorkspace,
  disposeTempRoots,
} from '../../extract/tests/session/session-fixtures';
import { factsExtractor } from '../../extract/tests/source-ingestion-fixtures';
import { runBuildStart } from '../src/build-start';
import { PluginContext } from '../src/context';
import { makeManifest } from './manifest-fixture';

const UNREADABLE = 'animus.ingestion.unreadable-source-file';
const DEV_MODE_SLOT = 7;

const lockedFiles: string[] = [];

afterEach(() => {
  for (const file of lockedFiles.splice(0)) chmodSync(file, 0o644);
  disposeTempRoots();
});

/** An app whose system extends a kit package; `lock` names the file, under
 *  the app or the kit, that cannot be read. */
function workspace(lock?: (dirs: { app: string; kit: string }) => string) {
  const dirs = createKitWorkspace();
  writeFileSync(join(dirs.app, 'src', 'Local.tsx'), 'export const L = 1;\n');
  if (lock) {
    const file = lock(dirs);
    chmodSync(file, 0o000);
    lockedFiles.push(file);
    // A root user can read a 0o000 file; then every check below is vacuous.
    expect(() => readFileSync(file, 'utf-8')).toThrow();
  }
  return dirs;
}

async function productionBuild(app: string, strict: boolean) {
  const prunes: boolean[] = [];
  const warnings: string[] = [];
  const ctx = new PluginContext({ system: './src/system.ts', strict }, () => ({
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
      prunes.push(args[DEV_MODE_SLOT] === false);
      return JSON.stringify(makeManifest());
    },
  }));
  ctx.rootDir = app;
  ctx.isProd = true;
  ctx.emissionProd = true;
  const logger = createLogger('silent');
  logger.warn = (message) => {
    warnings.push(message);
  };
  ctx.logger = logger;
  const build = runBuildStart(ctx, async (specifier) =>
    resolve(app, 'src', specifier)
  );
  return { build, prunes, warnings };
}

const CASES = [
  {
    name: 'a local file',
    lock: ({ app }: { app: string }) => join(app, 'src', 'Local.tsx'),
    file: /src\/Local\.tsx/,
  },
  {
    name: 'a package file',
    lock: ({ kit }: { kit: string }) => join(kit, 'src', 'Button.tsx'),
    file: /kits\/ui\/src\/Button\.tsx/,
  },
];

describe.each(CASES)('$name that cannot be read', ({ lock, file }) => {
  test('fails a strict build, naming the code and the file', async () => {
    const { app } = workspace(lock);
    const { build } = await productionBuild(app, true);

    await expect(build).rejects.toThrow(UNREADABLE);
    await expect((await productionBuild(app, true)).build).rejects.toThrow(
      file
    );
  });

  test('warns that it costs pruning, and prunes nothing', async () => {
    const { app } = workspace(lock);
    const { build, prunes, warnings } = await productionBuild(app, false);

    await build;
    const line = warnings.find((warning) => warning.includes(UNREADABLE));
    expect(line).toMatch(file);
    expect(line).toContain('its renders are not seen, so nothing is pruned');
    expect(prunes).toEqual([false]);
  });
});

test('a build whose every file reads still prunes', async () => {
  const { app } = workspace();
  const { build, prunes, warnings } = await productionBuild(app, true);

  await build;
  expect(warnings.join('\n')).not.toContain(UNREADABLE);
  expect(prunes).toEqual([true]);
});
