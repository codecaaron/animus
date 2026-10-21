import {
  existsSync,
  mkdirSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { resolveConfig } from 'vite';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { fakeEngineApi } from '../../extract/tests/native-functions';
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
interface ServeOptions {
  cacheDir?: string;
  /** The asset lives outside the app root. */
  outsideRoot?: boolean;
  fs?: { strict?: boolean; deny?: string[] };
  /** Paths the dev server's watcher is asked to add. */
  watched?: string[];
  logoBytes?: string;
}

async function serveWithAsset(options: ServeOptions = {}) {
  const { app, parent } = createKitWorkspace();
  const logo = join(options.outsideRoot ? parent : app, 'logo.svg');
  writeFileSync(logo, options.logoBytes ?? '<svg id="v1"/>');
  const specifier = options.outsideRoot ? '../logo.svg' : './logo.svg';
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const ctx = new PluginContext({ system: './src/system.ts' }, () => ({
    ...fakeEngineApi(),
    loadSystemModule: () => ({
      propConfig: '{}',
      groupRegistry: '{}',
      scalesJson: '{}',
      variableMapJson: '{}',
      variableCss: '',
      contextualVarsJson: '',
      dependencies: [],
    }),
    extractModuleFacts: factsExtractor({
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
      {
        configFile: false,
        root: app,
        logLevel: 'silent',
        cacheDir: options.cacheDir,
        server: { fs: options.fs },
      },
      'serve'
    )
  );
  if (options.watched) {
    const watched = options.watched;
    ctx.devServer = { watcher: { add: (path: string) => watched.push(path) } };
  }
  await runBuildStart(ctx, async (asked) =>
    asked === specifier ? logo : resolve(app, 'src', asked)
  );
  return { ctx, logo, specifier };
}

/** The file a dev asset URL serves: root-relative inside the root, `/@fs`
 *  outside. */
const servedFile = (ctx: PluginContext, url: string): string =>
  url.includes('/@fs/')
    ? url.slice(url.indexOf('/@fs') + 4)
    : join(ctx.viteRoot, url.slice(1));

describe('a Vite dev asset URL names an immutable copy', () => {
  test('an edit gets a new URL, and the old URL keeps the old bytes', async () => {
    const { ctx, logo, specifier } = await serveWithAsset();
    const first = ctx.assetUrlBySpecifier.get(specifier)!;
    expect(servedFile(ctx, first)).toContain('animus-assets');
    expect(ctx.globalCss).toContain(first);

    writeFileSync(logo, '<svg id="v2"/>');
    ctx.refreshAssetCopies(logo);

    const second = ctx.assetUrlBySpecifier.get(specifier)!;
    expect(second).not.toBe(first);
    expect(ctx.globalCss).toContain(second);
    expect(readFileSync(servedFile(ctx, first), 'utf-8')).toBe(
      '<svg id="v1"/>'
    );
    expect(readFileSync(servedFile(ctx, second), 'utf-8')).toBe(
      '<svg id="v2"/>'
    );
  });

  test('a cacheDir the dev server does not serve keeps the live file', async () => {
    const outside = makeTempRoot('animus-outside-cache-');
    const { ctx, logo, specifier } = await serveWithAsset({
      cacheDir: outside,
    });

    expect(ctx.assetCopyDir).toBeNull();
    expect(servedFile(ctx, ctx.assetUrlBySpecifier.get(specifier)!)).toBe(logo);
  });
});

describe('a Vite dev asset copy is served and kept', () => {
  test('an asset outside the root is watched once its copy exists', async () => {
    const watched: string[] = [];
    const { logo } = await serveWithAsset({ outsideRoot: true, watched });

    expect(watched).toContain(logo);
  });

  test('a copy directory server.fs.deny refuses keeps the live file', async () => {
    const { ctx, logo, specifier } = await serveWithAsset({
      fs: { deny: ['**/animus-assets/**'] },
    });

    expect(ctx.assetCopyDir).toBeNull();
    expect(servedFile(ctx, ctx.assetUrlBySpecifier.get(specifier)!)).toBe(logo);
  });

  test("a second server sharing the cacheDir keeps the first's copies, and a dead process's go", async () => {
    const cacheDir = makeTempRoot('animus-shared-cache-');
    const deadCopies = join(cacheDir, 'animus-assets', '2147483646');
    mkdirSync(deadCopies, { recursive: true });
    writeFileSync(join(deadCopies, 'old.abcd1234.svg'), '<svg/>');
    const fs = { strict: false };
    const first = await serveWithAsset({ cacheDir, fs });
    const firstCopy = servedFile(
      first.ctx,
      first.ctx.assetUrlBySpecifier.get(first.specifier)!
    );

    await serveWithAsset({ cacheDir, fs, logoBytes: '<svg id="other"/>' });

    expect(existsSync(firstCopy)).toBe(true);
    expect(existsSync(deadCopies)).toBe(false);
  });
});

describe('a Vite dev asset copy is checked and bounded', () => {
  test('a deny naming the copied file serves that asset live', async () => {
    const { ctx, logo, specifier } = await serveWithAsset({
      fs: { deny: ['**/animus-assets/**/*.svg'] },
    });

    expect(ctx.assetCopyDir).not.toBeNull();
    expect(servedFile(ctx, ctx.assetUrlBySpecifier.get(specifier)!)).toBe(logo);
  });

  test('a third edit removes the oldest copy and keeps the last two', async () => {
    const { ctx, logo, specifier } = await serveWithAsset();
    const copies = [servedFile(ctx, ctx.assetUrlBySpecifier.get(specifier)!)];
    for (const version of ['v2', 'v3']) {
      writeFileSync(logo, `<svg id="${version}"/>`);
      ctx.refreshAssetCopies(logo);
      copies.push(servedFile(ctx, ctx.assetUrlBySpecifier.get(specifier)!));
    }

    expect(copies.map((copy) => existsSync(copy))).toEqual([false, true, true]);
  });

  test('an old directory whose owner cannot prove its start time is swept', async () => {
    const cacheDir = makeTempRoot('animus-reused-pid-cache-');
    // A live pid, recorded with a start time it never had.
    const reused = join(cacheDir, 'animus-assets', `${process.ppid}-1`);
    mkdirSync(reused, { recursive: true });
    const dayAndAnHourAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);
    utimesSync(reused, dayAndAnHourAgo, dayAndAnHourAgo);

    await serveWithAsset({ cacheDir, fs: { strict: false } });

    expect(existsSync(reused)).toBe(false);
  });
});
