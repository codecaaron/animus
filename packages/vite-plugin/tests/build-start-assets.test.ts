import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';

import { runBuildStart } from '../src/build-start';
import { PluginContext } from '../src/context';
import { makeManifest } from './manifest-fixture';

/** Vite calls buildStart once per environment and per rebuild, so the asset
 *  pass resets: a stale reference id emits nothing and dangles in the CSS. */

const scratch = mkdtempSync(join(tmpdir(), 'animus-build-start-assets-'));

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

const FONT_SPECIFIER = '@acme/fonts/inter.woff2';

function makeContext() {
  mkdirSync(join(scratch, 'src'), { recursive: true });
  writeFileSync(join(scratch, 'src', 'ds.ts'), 'export const ds = {};\n');
  const fontPath = join(scratch, 'inter.woff2');
  writeFileSync(fontPath, 'font-bytes');

  const manifest = makeManifest({
    sheets: {
      ...makeManifest().sheets,
      global: `@font-face { font-family: Inter; src: url('animus-asset:${FONT_SPECIFIER}'); }`,
    },
  });
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
    analyzeProject: () => JSON.stringify(manifest),
  };

  const ctx = new PluginContext({ system: 'src/ds.ts' }, () => engine);
  ctx.rootDir = scratch;
  ctx.isProd = true;

  const emitted: string[] = [];
  const resolveSpecifier: Parameters<typeof runBuildStart>[1] = async (
    specifier
  ) => (specifier === FONT_SPECIFIER ? fontPath : null);
  const emitAsset: NonNullable<Parameters<typeof runBuildStart>[2]> = (
    _fileName,
    _source
  ) => {
    const referenceId = `ref${emitted.length + 1}`;
    emitted.push(referenceId);
    return referenceId;
  };
  return {
    ctx,
    emitted,
    resolveSpecifier,
    emitAsset,
  };
}

describe('runBuildStart asset pass across environments/rebuilds', () => {
  test('a second buildStart re-emits and substitutes fresh reference ids', async () => {
    const { ctx, emitted, resolveSpecifier, emitAsset } = makeContext();

    await runBuildStart(ctx, resolveSpecifier, emitAsset);
    expect(ctx.globalCss).toContain('__VITE_ASSET__ref1__');
    expect(emitted).toEqual(['ref1']);

    await runBuildStart(ctx, resolveSpecifier, emitAsset);
    expect(emitted).toEqual(['ref1', 'ref2']);
    expect(ctx.globalCss).toContain('__VITE_ASSET__ref2__');
    expect(ctx.globalCss).not.toContain('__VITE_ASSET__ref1__');
  });
});
