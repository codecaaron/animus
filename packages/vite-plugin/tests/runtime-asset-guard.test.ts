import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createLogger, resolveConfig } from 'vite';
import { afterEach, expect, test } from 'vitest';

import {
  disposeTempRoots,
  makeTempRoot,
} from '../../extract/tests/session/session-fixtures';
import { runBuildStart } from '../src/build-start';
import { applyResolvedConfig } from '../src/config';
import { PluginContext } from '../src/context';
import { makeManifest } from './manifest-fixture';

import type { ProjectManifest } from '@animus-ui/extract/pipeline';

/** Runtime prop configs and component code reach the browser as generated
 *  modules, where an asset() placeholder loads nothing. Extraction lifts each
 *  one into a root variable, and the guard reports any that is left. */

afterEach(() => {
  disposeTempRoots();
});

const ROCK = 'url("animus-asset:@acme/media/rock.jpg")';

function scaleValuesManifest(rock: string): ProjectManifest {
  return makeManifest({
    dynamic_props: {
      bgImage: {
        varName: '--animus-bg-image',
        slotClass: 'animus-dyn-bg-image',
        property: 'backgroundImage',
        scaleValues: { rock },
      },
    },
  });
}

/** A Vite build whose analysis returns `manifest`; the warnings Vite's
 *  logger received. */
async function build(manifest: ProjectManifest, strict: boolean) {
  const root = realpathSync(makeTempRoot('animus-runtime-asset-guard-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'ds.ts'), 'export const ds = {};\n');
  writeFileSync(join(root, 'src', 'App.tsx'), 'export const App = 1;\n');
  const warnings: string[] = [];
  const customLogger = createLogger('silent');
  customLogger.warn = (message) => {
    warnings.push(message);
  };
  const ctx = new PluginContext({ system: './src/ds.ts', strict }, () => ({
    loadSystemModule: () => ({
      propConfig: '{}',
      groupRegistry: '{}',
      scalesJson: '{}',
      variableMapJson: '{}',
      variableCss: '',
      dependencies: [],
    }),
    extractFacts: () => JSON.stringify({ files: {}, parseCount: 0 }),
    analyzeProject: () => JSON.stringify(manifest),
  }));
  applyResolvedConfig(
    ctx,
    await resolveConfig(
      { configFile: false, root, logLevel: 'silent', customLogger },
      'build'
    )
  );
  const run = () =>
    runBuildStart(ctx, async (specifier) => resolve(root, specifier));
  return { run, warnings };
}

test('a placeholder left in a runtime config fails a strict build', async () => {
  const { run } = await build(scaleValuesManifest(ROCK), true);
  await expect(run()).rejects.toThrow(
    '[animus] ✖ generated runtime modules: asset(): placeholders reached it unsubstituted: @acme/media/rock.jpg [animus.asset.unsubstituted-placeholder]'
  );
});

test('a non-strict build warns about it', async () => {
  const { run, warnings } = await build(scaleValuesManifest(ROCK), false);
  await run();
  expect(warnings.join('\n')).toContain('generated runtime modules');
});

test('a runtime config reading a root variable reports nothing', async () => {
  const lifted = scaleValuesManifest('var(--animus-asset-1a2b3c4d)');
  lifted.sheets.global = `@layer anm-global {\n:root {\n  --animus-asset-1a2b3c4d: ${ROCK};\n}\n}\n`;
  const { run, warnings } = await build(lifted, true);
  await run();
  expect(warnings).toEqual([]);
});
