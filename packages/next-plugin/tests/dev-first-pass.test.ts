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

import { ExtractionSession } from '../../extract/session/extraction-session';
import { startTurbopackWatcher } from '../../extract/session/turbopack-orchestrator';
import {
  buildManifest,
  createProject,
  disposeTempRoots,
  resetAnimusGlobals,
  SYSTEM_CONFIG,
} from '../../extract/tests/session/session-fixtures';
import { AnimusWebpackPlugin } from '../src/plugin';
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
    if (wrapped instanceof Promise) throw new Error('unexpected async config');
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
  async function firstPass(nodeEnv: string): Promise<void> {
    vi.stubEnv('NODE_ENV', nodeEnv);
    process.chdir(createProject('animus-next-first-pass-'));
    // Claiming the root first leaves withAnimus no dev watcher to start, and
    // the test a handle to close.
    const claim = startTurbopackWatcher(
      new ExtractionSession({ system: './src/system.ts' }),
      process.cwd()
    );
    try {
      await withAnimus({
        system: './src/system.ts',
        turbopack: { mode: 'on' },
      })({});
    } finally {
      if (claim.kind === 'started') claim.handle.close();
    }
  }

  test('keeps unrendered CSS under next dev', async () => {
    await firstPass('development');
    expect(firstPassDevMode()).toBe(true);
  });

  test('prunes in a build', async () => {
    await firstPass('production');
    expect(firstPassDevMode()).toBe(false);
  });
});
