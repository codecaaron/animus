import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, test, vi } from 'vitest';

import { PluginContext } from '../src/context';
import { makeManifest } from './manifest-fixture';

import type { ProjectManifest } from '@animus-ui/extract/pipeline';

/** Runtime prop configs and component code reach the browser as generated
 *  modules, where an asset() placeholder loads nothing. Extraction lifts each
 *  one into a root variable, and the guard reports any that is left. */

const scratch = mkdtempSync(join(tmpdir(), 'animus-runtime-asset-guard-'));

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
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

/** The manifest a later analysis returns, once a test sets it. */
interface NextAnalysis {
  manifest?: ProjectManifest;
}

function analyze(
  manifest: ProjectManifest,
  strict: boolean,
  next: NextAnalysis = {}
) {
  mkdirSync(join(scratch, 'src'), { recursive: true });
  writeFileSync(join(scratch, 'src', 'ds.ts'), 'export const ds = {};\n');
  const engine = {
    loadSystemModule: () => ({
      propConfig: '{}',
      groupRegistry: '{}',
      scalesJson: '{}',
      variableMapJson: '{}',
      variableCss: '',
      dependencies: [],
    }),
    extractFacts: () => JSON.stringify({ files: {}, parseCount: 0 }),
    analyzeProject: () => JSON.stringify(next.manifest ?? manifest),
  };
  const ctx = new PluginContext({ system: 'src/ds.ts', strict }, () => engine);
  ctx.rootDir = scratch;
  ctx.loadSystem();
  const warn = vi.spyOn(ctx, 'warn').mockImplementation(() => {});
  return { ctx, run: () => ctx.runAnalysis([]), warn };
}

test('a placeholder left in a runtime config fails a strict build', () => {
  const { run } = analyze(scaleValuesManifest(ROCK), true);
  expect(run).toThrow(
    'asset() placeholders reached generated runtime modules unsubstituted: @acme/media/rock.jpg (animus.asset.unsubstituted-placeholder)'
  );
});

test('a non-strict build warns about it', () => {
  const { run, warn } = analyze(scaleValuesManifest(ROCK), false);
  run();
  expect(warn).toHaveBeenCalledWith(
    expect.stringContaining('generated runtime modules')
  );
});

test('a runtime config reading a root variable reports nothing', () => {
  const lifted = scaleValuesManifest('var(--animus-asset-1a2b3c4d)');
  lifted.sheets.global = `@layer anm-global {\n:root {\n  --animus-asset-1a2b3c4d: ${ROCK};\n}\n}\n`;
  const { run, warn } = analyze(lifted, true);
  expect(run()).toBe(true);
  expect(warn).not.toHaveBeenCalled();
});

test('a strict failure keeps the last published analysis whole', () => {
  const published = scaleValuesManifest('var(--animus-asset-1a2b3c4d)');
  published.css = '.animus-u-1 { padding: 4px; }';
  published.sheets.global = '@layer anm-global {\n:root {}\n}\n';
  published.system_prop_map = { p: { '4': 'animus-u-1' } };
  const next: NextAnalysis = {};
  const { ctx, run } = analyze(published, true, next);
  run();
  const before = {
    manifest: ctx.storedManifest,
    manifestJson: ctx.storedManifestJson,
    propMap: ctx.storedSystemPropMapJson,
    dynamicProps: ctx.storedDynamicPropsJson,
    globalCss: ctx.globalCss,
    componentCss: ctx.resolvedComponentCss,
  };

  next.manifest = scaleValuesManifest(ROCK);
  next.manifest.css = '.animus-u-2 { padding: 8px; }';
  next.manifest.system_prop_map = { p: { '8': 'animus-u-2' } };
  expect(run).toThrow('generated runtime modules');

  expect({
    manifest: ctx.storedManifest,
    manifestJson: ctx.storedManifestJson,
    propMap: ctx.storedSystemPropMapJson,
    dynamicProps: ctx.storedDynamicPropsJson,
    globalCss: ctx.globalCss,
    componentCss: ctx.resolvedComponentCss,
  }).toEqual(before);
});
