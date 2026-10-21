import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { setEngineApiOverride } from '../../extract/session/singleton';
import {
  fakeEngineApi,
  nativeFunctions,
} from '../../extract/tests/native-functions';
import {
  buildManifest,
  createProject,
  disposeTempRoots,
  PLAN_A,
  resetAnimusGlobals,
  SYSTEM_CONFIG,
} from '../../extract/tests/session/session-fixtures';
import { parserStoppingAt } from '../../extract/tests/source-ingestion-fixtures';
import { unpluginFactory } from '../src/core';

let restoreGlobals: (() => void) | null = null;

afterEach(() => {
  restoreGlobals?.();
  setEngineApiOverride(null);
  vi.restoreAllMocks();
  disposeTempRoots();
});

describe("a failed load's observations are watched", () => {
  test('rollup watch registers the files the load read and the paths it found absent', async () => {
    restoreGlobals = resetAnimusGlobals();
    const root = createProject('animus-unplugin-failed-load-');
    const palette = join(root, 'src', 'palette.ts');
    const absent = join(root, 'src', 'theme.ts');
    setEngineApiOverride(() => ({
      ...fakeEngineApi(),
      extractModuleFacts: () => '{"files":{},"parseCount":0}',
      loadSystemModule: () => {
        throw Object.assign(new Error('SyntaxError in palette.ts'), {
          dependencies: [join(root, 'src', 'system.ts'), palette],
          missing: [absent],
        });
      },
      analyzeProject: () => '',
      clearAnalysisCache: () => {},
    }));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const plugin = unpluginFactory(
      { system: './src/system.ts', root },
      { framework: 'rollup', watchMode: true, versions: {} }
    );
    if (Array.isArray(plugin) || !plugin.rollup?.buildStart) {
      throw new Error('expected one plugin with a rollup buildStart');
    }
    const hook = plugin.rollup.buildStart;
    const buildStart = 'handler' in hook ? hook.handler : hook;
    const watched: string[] = [];
    const context = {
      meta: { watchMode: true },
      addWatchFile: (path: string) => watched.push(path),
    };

    await expect(
      // SAFETY: the hook reads only `meta.watchMode` and `addWatchFile` from
      // its context, and only `plugins` from its options.
      buildStart.call(context as never, { plugins: [] } as never)
    ).rejects.toThrow('palette.ts');

    expect(watched).toEqual(expect.arrayContaining([palette, absent]));
  });
});

/** A webpack compiler's hooks, recorded so a row can fire them. */
function fakeWebpackCompiler() {
  const done: Array<() => void> = [];
  const failed: Array<() => void> = [];
  const watchClose: Array<() => void> = [];
  const taps = { done, failed, watchClose };
  const hook = (name: keyof typeof taps) => ({
    tap: (_plugin: string, fn: () => void) => {
      taps[name].push(fn);
    },
  });
  const compiler = {
    options: { mode: 'development', resolve: {} },
    watchMode: true,
    webpack: {
      version: '5.105.4',
      DefinePlugin: class {
        apply() {}
      },
    },
    hooks: {
      done: hook('done'),
      failed: hook('failed'),
      watchClose: hook('watchClose'),
      normalModuleFactory: { tap: () => {} },
    },
  };
  return {
    compiler,
    fire: (name: keyof typeof taps) => taps[name].forEach((fn) => fn()),
  };
}

/** A webpack plugin instance over a project whose system loads, wired to a
 *  fake compiler; `make` runs its buildStart, which webpack maps to make. */
function webpackHost(root: string) {
  const { compiler, fire } = fakeWebpackCompiler();
  const plugin = unpluginFactory(
    { system: './src/system.ts', root },
    // SAFETY: the fake models every compiler member the plugin's webpack
    // wiring reads (options, watchMode, webpack.DefinePlugin, hooks).
    {
      framework: 'webpack',
      versions: {},
      webpack: { compiler: compiler as never },
    }
  );
  if (Array.isArray(plugin) || !plugin.webpack || !plugin.buildStart) {
    throw new Error('expected one plugin with webpack and buildStart hooks');
  }
  // SAFETY: as above.
  plugin.webpack(compiler as never);
  const buildStart = plugin.buildStart;
  // SAFETY: the hook reads nothing from its context under webpack.
  const make = () => buildStart.call({} as never);
  return { make, fire };
}

describe('a webpack compile that ends without done or failed', () => {
  function loadableSystem(): string {
    restoreGlobals = resetAnimusGlobals();
    const root = createProject('animus-unplugin-webpack-');
    setEngineApiOverride(() => ({
      ...nativeFunctions(),
      extractModuleFacts: parserStoppingAt('(('),
      loadSystemModule: () => ({ ...SYSTEM_CONFIG, dependencies: [] }),
      analyzeProject: () => buildManifest(PLAN_A),
      transformFile: (source: string) => ({
        code: source,
        hasComponents: false,
      }),
      clearAnalysisCache: () => {},
    }));
    return root;
  }

  test('an edit that restarts the compile never strands its Session', async () => {
    const { make } = webpackHost(loadableSystem());

    await make();
    // webpack restarted the invalidated compile: no done, no failed.
    await expect(make()).resolves.toBeUndefined();
  });

  test('a watch closed mid-compile retires its build', async () => {
    const root = loadableSystem();
    const sessions = join(root, '.animus', 'sessions');
    const { make, fire } = webpackHost(root);
    await make();
    expect(readdirSync(sessions)).toHaveLength(1);

    // webpack closed the watch mid-compile: watchClose, no done.
    fire('watchClose');
    expect(existsSync(sessions) ? readdirSync(sessions) : []).toEqual([]);
  });
});

describe('a Rollup watch rebuild', () => {
  // Contract: Rollup runs the plugin's own `rollup.buildStart`; the build it
  // opens is the one buildEnd retires, so the watch's next build claims the
  // build again instead of meeting its own claim.
  test('claims its build again after the previous build ended', async () => {
    restoreGlobals = resetAnimusGlobals();
    const root = createProject('animus-unplugin-rollup-rebuild-');
    setEngineApiOverride(() => ({
      ...nativeFunctions(),
      extractModuleFacts: parserStoppingAt('(('),
      loadSystemModule: () => ({ ...SYSTEM_CONFIG, dependencies: [] }),
      analyzeProject: () => buildManifest(PLAN_A),
      transformFile: (source: string) => ({
        code: source,
        hasComponents: false,
      }),
      clearAnalysisCache: () => {},
    }));
    const plugin = unpluginFactory(
      { system: './src/system.ts', root },
      { framework: 'rollup', watchMode: true, versions: {} }
    );
    if (
      Array.isArray(plugin) ||
      !plugin.rollup?.buildStart ||
      !plugin.buildEnd
    ) {
      throw new Error(
        'expected one plugin with rollup buildStart and buildEnd'
      );
    }
    const startHook = plugin.rollup.buildStart;
    const buildStart = 'handler' in startHook ? startHook.handler : startHook;
    const buildEnd = plugin.buildEnd;
    const context = {
      meta: { watchMode: true },
      addWatchFile: () => {},
      emitFile: () => 'animus-css',
    };
    // SAFETY: the hooks read only `meta.watchMode`, `addWatchFile` and
    // `emitFile` from their context, and only `plugins` from the options.
    const start = () =>
      buildStart.call(context as never, { plugins: [] } as never);
    // SAFETY: as above.
    const end = () => buildEnd.call(context as never);

    await start();
    await end();
    // An edit: Rollup's watch builds again on the same plugin instance.
    await expect(start()).resolves.toBeUndefined();
  });
});
