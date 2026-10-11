import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { resolveConfig } from 'vite';
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  createKitWorkspace,
  disposeTempRoots,
  KIT_SYSTEM_SOURCE,
  makeTempRoot,
} from '../../extract/tests/session/session-fixtures';
import {
  emptyFacts,
  factsExtractor,
  systemImportFacts,
} from '../../extract/tests/source-ingestion-fixtures';
import { runBuildStart } from '../src/build-start';
import { applyResolvedConfig } from '../src/config';
import { PluginContext } from '../src/context';
import { makeManifest } from './manifest-fixture';

afterEach(() => {
  vi.restoreAllMocks();
  disposeTempRoots();
});

/** A dev server's first pass over an app whose global sheet names one
 *  asset(): the context, the asset's source file and its specifier. */
async function serveWithAsset(cacheDir?: string) {
  const { app } = createKitWorkspace();
  const logo = join(app, 'logo.svg');
  writeFileSync(logo, '<svg id="v1"/>');
  const specifier = './logo.svg';
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const ctx = new PluginContext({ system: './src/system.ts' }, () => ({
    loadSystemModule: () => ({
      propConfig: '{}',
      groupRegistry: '{}',
      scalesJson: '{}',
      variableMapJson: '{}',
      variableCss: '',
      dependencies: [],
    }),
    extractFacts: factsExtractor({
      [join(app, 'src', 'system.ts')]: {
        ...emptyFacts(join(app, 'src', 'system.ts')),
        imports: systemImportFacts(KIT_SYSTEM_SOURCE),
      },
    }),
    analyzeProject: () => {
      const manifest = makeManifest();
      manifest.sheets.global = `@layer anm-global{body{background:url('animus-asset:${specifier}')}}`;
      return JSON.stringify(manifest);
    },
  }));
  applyResolvedConfig(
    ctx,
    await resolveConfig(
      { configFile: false, root: app, logLevel: 'silent', cacheDir },
      'serve'
    )
  );
  await runBuildStart(ctx, async (asked) =>
    asked === specifier ? logo : resolve(app, 'src', asked)
  );
  return { ctx, logo, specifier };
}

/** The file a dev `/@fs` URL serves. */
const servedFile = (url: string): string => url.slice(url.indexOf('/@fs') + 4);

describe('a Vite dev asset URL names an immutable copy', () => {
  test('an edit gets a new URL, and the old URL keeps the old bytes', async () => {
    const { ctx, logo, specifier } = await serveWithAsset();
    const first = ctx.assetUrlBySpecifier.get(specifier)!;
    expect(servedFile(first)).toContain('animus-assets');
    expect(ctx.globalCss).toContain(first);

    writeFileSync(logo, '<svg id="v2"/>');
    ctx.refreshAssetCopies(logo);

    const second = ctx.assetUrlBySpecifier.get(specifier)!;
    expect(second).not.toBe(first);
    expect(ctx.globalCss).toContain(second);
    expect(readFileSync(servedFile(first), 'utf-8')).toBe('<svg id="v1"/>');
    expect(readFileSync(servedFile(second), 'utf-8')).toBe('<svg id="v2"/>');
  });

  test('a cacheDir the dev server does not serve keeps the live file', async () => {
    const outside = makeTempRoot('animus-outside-cache-');
    const { ctx, logo, specifier } = await serveWithAsset(outside);

    expect(ctx.assetCopyDir).toBeNull();
    expect(servedFile(ctx.assetUrlBySpecifier.get(specifier)!)).toBe(logo);
  });
});
