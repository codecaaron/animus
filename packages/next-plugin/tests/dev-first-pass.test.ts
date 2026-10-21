import { appendFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { nativeFunctions } from '../../extract/tests/native-functions';

const mocks = vi.hoisted(() => ({
  loadSystemModule: vi.fn(),
  analyzeProject: vi.fn<(...args: AnalyzeProjectArgs) => string>(),
  clearAnalysisCache: vi.fn(),
}));

import { setEngineApiOverride } from '../../extract/session/singleton';

setEngineApiOverride(() => ({
  ...nativeFunctions(),
  loadSystemModule: mocks.loadSystemModule,
  extractModuleFacts: () => '{"files":{},"parseCount":0}',
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
  makeTempRoot,
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
    const wrapped = withAnimus({ system: './src/system.ts', mode, root })({});
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

  /** The build a resolved config's Animus loader serves. */
  function loadBuild(
    resolved: Awaited<
      ReturnType<ReturnType<typeof turbopackConfigInNewProject>>
    >
  ): string {
    // SAFETY: the Animus rule is buildTurbopackConfig's, whose one loader
    // carries the session's id in its options.
    const rule = resolved.turbopack.rules?.[ANIMUS_TURBOPACK_RULE_GLOB] as {
      loaders: Array<{ options: { sessionId: string } }>;
    };
    return rule.loaders[0].options.sessionId;
  }

  /** A root that build `build` already watches refuses it a second watcher. */
  function rootWatched(build: string): boolean {
    const probe = startTurbopackWatcher(
      new ExtractionSession({ system: './src/system.ts' }, { build }),
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
    const watching = rootWatched(loadBuild(resolved));
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
    const dev = await config('phase-development-server');
    // As Next's validateTurboNextConfig does after Ready.
    await config('phase-development-server');
    expect(mocks.analyzeProject).toHaveBeenCalledTimes(1);
    expect(rootWatched(loadBuild(dev))).toBe(true);
    await config('phase-production-build');
  });

  test('a load in another phase replaces the session and closes its watcher', async () => {
    const config = turbopackConfigInNewProject();
    const dev = await config('phase-development-server');
    expect(rootWatched(loadBuild(dev))).toBe(true);
    await config('phase-production-build');
    expect(mocks.analyzeProject).toHaveBeenCalledTimes(2);
    expect(rootWatched(loadBuild(dev))).toBe(false);
  });

  test('a dev load replaced while it analyzes starts no watcher', async () => {
    const config = turbopackConfigInNewProject();
    const [dev] = await Promise.allSettled([
      config('phase-development-server'),
      config('phase-production-build'),
    ]);
    const watched =
      dev.status === 'fulfilled' && rootWatched(loadBuild(dev.value));
    if (watched) await config('phase-production-server');
    expect(watched).toBe(false);
  });

  // Contract: a source edit made while the first dev analysis runs is
  // analyzed once that analysis publishes, not lost to a watcher that
  // started after it.
  test('an edit during the first dev analysis is analyzed after it', async () => {
    const config = turbopackConfigInNewProject();
    const button = join(process.cwd(), 'src', 'Button.tsx');
    mocks.analyzeProject.mockImplementationOnce(() => {
      // A real first analysis runs for seconds; the pause lets a watcher
      // registered before it start reporting, as fs.watch does not at once.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
      appendFileSync(button, '// edited during the first analysis\n');
      return buildManifest({});
    });

    const dev = await config('phase-development-server');
    await vi.waitFor(
      () => expect(mocks.analyzeProject).toHaveBeenCalledTimes(2),
      { timeout: 2000 }
    );
    expect(rootWatched(loadBuild(dev))).toBe(true);
    await config('phase-production-build');
  });

  // Contract: a system dependency outside the watched tree that changes
  // while the first dev pass runs is reloaded once that pass publishes. The
  // watcher learns of it only from the load, after the edit, so the edit
  // reaches it as the bytes that load read, not as an event.
  test('an outside-root system dependency edited during the first dev pass reloads after it', async () => {
    const config = turbopackConfigInNewProject();
    const tokens = join(makeTempRoot('animus-outside-tokens-'), 'tokens.ts');
    writeFileSync(tokens, "export const brand = 'red';\n");
    mocks.loadSystemModule.mockImplementation(() => ({
      ...SYSTEM_CONFIG,
      dependencies: [tokens],
    }));
    mocks.analyzeProject.mockImplementationOnce(() => {
      appendFileSync(tokens, "export const accent = 'blue';\n");
      return buildManifest({});
    });

    const dev = await config('phase-development-server');
    await vi.waitFor(
      () => expect(mocks.loadSystemModule).toHaveBeenCalledTimes(2),
      { timeout: 2000 }
    );
    expect(rootWatched(loadBuild(dev))).toBe(true);
    await config('phase-production-build');
  });
});
