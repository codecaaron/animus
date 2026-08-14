import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';

import { runBuildStart } from '../src/build-start';
import { PluginContext } from '../src/context';

/**
 * asset() lifecycle across REPEATED buildStarts on one PluginContext
 * (global-styles-system): Vite calls buildStart once per environment (and
 * once per rebuild under --watch), so the bundler-resolved asset pass must
 * start from a clean slate every time. A stale `assetPassComplete` +
 * `assetUrlBySpecifier` from build #1 would let runAnalysis splice build
 * #1's Rollup reference ids into build #2's CSS before the resolution loop
 * runs — leaving nothing to emit and a dangling reference id.
 */

const scratch = mkdtempSync(join(tmpdir(), 'animus-build-start-assets-'));

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

const FONT_SPECIFIER = '@acme/fonts/inter.woff2';

function makeContext(): {
  ctx: PluginContext;
  emitted: string[];
  resolveSpecifier: (specifier: string) => Promise<string | null>;
  emitAsset: (fileName: string, source: Uint8Array) => string;
} {
  mkdirSync(join(scratch, 'src'), { recursive: true });
  writeFileSync(join(scratch, 'src', 'ds.ts'), 'export const ds = {};\n');
  const fontPath = join(scratch, 'inter.woff2');
  writeFileSync(fontPath, 'font-bytes');

  const manifest = {
    components: {},
    sheets: {
      global: `@font-face { font-family: Inter; src: url('animus-asset:${FONT_SPECIFIER}'); }`,
    },
    css: '',
  };
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
  return {
    ctx,
    emitted,
    resolveSpecifier: async (specifier) =>
      specifier === FONT_SPECIFIER ? fontPath : null,
    emitAsset: (_fileName, _source) => {
      const referenceId = `ref${emitted.length + 1}`;
      emitted.push(referenceId);
      return referenceId;
    },
  };
}

describe('runBuildStart asset pass across environments/rebuilds', () => {
  test('a second buildStart re-emits and substitutes fresh reference ids', async () => {
    const { ctx, emitted, resolveSpecifier, emitAsset } = makeContext();

    await runBuildStart(ctx, resolveSpecifier, emitAsset);
    expect(ctx.globalCss).toContain('__VITE_ASSET__ref1__');
    expect(emitted).toEqual(['ref1']);

    // Same context, fresh Rollup output scope: e.g. the ssr environment of
    // a multi-environment build, or the next `vite build --watch` pass.
    await runBuildStart(ctx, resolveSpecifier, emitAsset);
    expect(emitted).toEqual(['ref1', 'ref2']);
    expect(ctx.globalCss).toContain('__VITE_ASSET__ref2__');
    expect(ctx.globalCss).not.toContain('__VITE_ASSET__ref1__');
  });
});
