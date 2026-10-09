import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadSystemModule: vi.fn(),
  analyzeProject: vi.fn<(...args: AnalyzeProjectArgs) => string>(),
  clearAnalysisCache: vi.fn(),
}));

import { setEngineApiOverride } from '../../extract/session/singleton';

setEngineApiOverride(() => ({
  loadSystemModule: mocks.loadSystemModule,
  extractFacts: () => '{"files":{},"parseCount":0}',
  analyzeProject: mocks.analyzeProject,
  clearAnalysisCache: mocks.clearAnalysisCache,
}));

// The package entry, as with-animus imports it: the source module would
// keep its own set of watched roots.
import {
  ExtractionSession,
  startTurbopackWatcher,
} from '@animus-ui/extract/session';

import {
  buildManifest,
  createProject,
  disposeTempRoots,
  resetAnimusGlobals,
  SYSTEM_CONFIG,
} from '../../extract/tests/session/session-fixtures';
import { AnimusWebpackPlugin } from '../src/plugin';
import { ANIMUS_TURBOPACK_RULE_GLOB } from '../src/turbopack-config';
import { withAnimus } from '../src/with-animus';

import type { AnalyzeProjectArgs } from '../../extract/pipeline';
import type { AnimusMode } from '../../extract/pipeline/core-options';

/**
 * The first full pass runs in the host's mode. Under `next dev` the engine
 * keeps CSS no render writes yet, as every later dev pass does; a build
 * prunes it.
 */

const DEV_MODE_SLOT = 7;

let restoreGlobals: () => void;
let savedCwd: string;

function firstPassDevMode(): boolean {
  const calls = mocks.analyzeProject.mock.calls;
  expect(calls).toHaveLength(1);
  return calls[0][DEV_MODE_SLOT];
}

beforeEach(() => {
  restoreGlobals = resetAnimusGlobals();
  savedCwd = process.cwd();
  mocks.loadSystemModule.mockReset().mockReturnValue({ ...SYSTEM_CONFIG });
  mocks.analyzeProject.mockReset().mockImplementation(() => buildManifest({}));
  mocks.clearAnalysisCache.mockReset();
});

afterEach(() => {
  process.chdir(savedCwd);
  vi.unstubAllEnvs();
  restoreGlobals();
  vi.restoreAllMocks();
  disposeTempRoots();
});

type PluginCompiler = Parameters<AnimusWebpackPlugin['apply']>[0];
type AsyncHandler = Parameters<PluginCompiler['hooks']['run']['tapPromise']>[1];

/** Runs the hook Next drives first: `watchRun` under `next dev`, `run` in a
 *  build. */
async function firstWebpackTurn(
  plugin: AnimusWebpackPlugin,
  root: string,
  dev: boolean
): Promise<void> {
  const runHandlers: AsyncHandler[] = [];
  const watchRunHandlers: AsyncHandler[] = [];
  const compiler: PluginCompiler = {
    hooks: {
      run: { tapPromise: (_name, fn) => runHandlers.push(fn) },
      watchRun: { tapPromise: (_name, fn) => watchRunHandlers.push(fn) },
      compilation: { tap: () => {} },
      thisCompilation: { tap: () => {} },
    },
    context: root,
    options: {},
    webpack: {
      Compilation: { PROCESS_ASSETS_STAGE_ADDITIONAL: -100 },
      sources: { RawSource: class {} },
      NormalModule: {
        getCompilationHooks: () => ({ needBuild: { tapAsync: () => {} } }),
      },
    },
  };
  plugin.apply(compiler);
  for (const handler of dev ? watchRunHandlers : runHandlers) {
    await handler(compiler);
  }
}

describe('the webpack first full pass', () => {
  async function firstPass(dev: boolean, mode?: AnimusMode): Promise<void> {
    const root = createProject('animus-next-first-pass-');
    const wrapped = withAnimus({ system: './src/system.ts', mode })({});
    if (!('webpack' in wrapped)) {
      throw new Error('withAnimus returned the Turbopack branch');
    }
    const config = wrapped.webpack?.({}, { dev, dir: root });
    const plugin = config?.plugins?.find(
      (candidate): candidate is AnimusWebpackPlugin =>
        candidate instanceof AnimusWebpackPlugin
    );
    if (plugin === undefined)
      throw new Error('no AnimusWebpackPlugin injected');
    await firstWebpackTurn(plugin, root, dev);
  }

  test('keeps unrendered CSS under next dev', async () => {
    await firstPass(true);
    expect(firstPassDevMode()).toBe(true);
  });

  test('prunes in a build', async () => {
    await firstPass(false);
    expect(firstPassDevMode()).toBe(false);
  });

  test('an explicit mode wins over the dev flag', async () => {
    await firstPass(true, 'production');
    expect(firstPassDevMode()).toBe(false);
  });
});

describe('the Turbopack first full pass', () => {
  function turbopackConfigInNewProject(mode?: AnimusMode) {
    process.chdir(createProject('animus-next-first-pass-'));
    const config = withAnimus({
      system: './src/system.ts',
      mode,
      turbopack: { mode: 'on' },
    })({});
    if ('webpack' in config) {
      throw new Error('withAnimus returned the webpack branch');
    }
    return config;
  }

  /** A root that is already watched refuses a second watcher. */
  function rootWatched(): boolean {
    const probe = startTurbopackWatcher(
      new ExtractionSession({ system: './src/system.ts' }),
      process.cwd()
    );
    if (probe.kind === 'started') probe.handle.close();
    return probe.kind === 'already-watched';
  }

  /** Resolves the config as Next does in `phase`, and reports the first
   *  pass's engine mode, whether a dev watcher now holds the root, and the
   *  Animus loader rule. */
  async function loadInPhase(phase: string, mode?: AnimusMode) {
    const config = turbopackConfigInNewProject(mode);
    const resolved = await config(phase);
    const devMode = firstPassDevMode();
    const watching = rootWatched();
    // A load in another phase closes the watcher of the session it replaces.
    if (watching) await config('phase-production-build');
    return {
      devMode,
      watching,
      loaderRule: resolved.turbopack.rules?.[ANIMUS_TURBOPACK_RULE_GLOB],
    };
  }

  /** The loader takes the dev delivery path only where a watcher publishes
   *  newer generations. */
  const loaderTakingDevPath = (development: boolean) => ({
    loaders: [
      expect.objectContaining({
        options: expect.objectContaining({ development }),
      }),
    ],
  });

  test('next dev analyzes in dev mode, starts the watcher and sends the loader down the dev path', async () => {
    expect(await loadInPhase('phase-development-server')).toEqual({
      devMode: true,
      watching: true,
      loaderRule: loaderTakingDevPath(true),
    });
  });

  test('next build prunes, starts no watcher and sends the loader down the build path, even with NODE_ENV=development', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(await loadInPhase('phase-production-build')).toEqual({
      devMode: false,
      watching: false,
      loaderRule: loaderTakingDevPath(false),
    });
  });

  test('an explicit mode wins for the analysis; the watcher and loader path follow the phase', async () => {
    expect(await loadInPhase('phase-development-server', 'production')).toEqual(
      { devMode: false, watching: true, loaderRule: loaderTakingDevPath(true) }
    );
    mocks.analyzeProject.mockClear();
    expect(await loadInPhase('phase-production-build', 'development')).toEqual({
      devMode: true,
      watching: false,
      loaderRule: loaderTakingDevPath(false),
    });
  });

  test('loading again in the same phase shares the analysis and keeps the watcher', async () => {
    const config = turbopackConfigInNewProject();
    await config('phase-development-server');
    // As Next's validateTurboNextConfig does after Ready.
    await config('phase-development-server');
    expect(mocks.analyzeProject).toHaveBeenCalledTimes(1);
    expect(rootWatched()).toBe(true);
    await config('phase-production-build');
  });

  test('a load in another phase replaces the session and closes its watcher', async () => {
    const config = turbopackConfigInNewProject();
    await config('phase-development-server');
    expect(rootWatched()).toBe(true);
    await config('phase-production-build');
    expect(mocks.analyzeProject).toHaveBeenCalledTimes(2);
    expect(rootWatched()).toBe(false);
  });

  test('a dev load replaced while it analyzes starts no watcher', async () => {
    const config = turbopackConfigInNewProject();
    await Promise.allSettled([
      config('phase-development-server'),
      config('phase-production-build'),
    ]);
    const watched = rootWatched();
    if (watched) await config('phase-production-server');
    expect(watched).toBe(false);
  });
});
