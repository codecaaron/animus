/**
 * Epoch-driven needBuild fan-out + epoch watch-ignore (openspec:
 * next-webpack-served-transform-coherence, design D1/D2/D7 — increment 02).
 *
 * When a watchRun transaction moves the replacement epoch, every module
 * whose loader chain contains the animus loader is forced to rebuild within
 * that compilation via `NormalModule.getCompilationHooks(compilation)
 * .needBuild`; other modules are untouched; the force is armed per
 * compilation and cleared once captured. The epoch artifact path is
 * appended to `watchOptions.ignored` (preserving user shapes), and a
 * webpack without the needBuild hook API fails loudly at apply time.
 *
 * Same harness as plugin-pipeline.test.ts (mocked NAPI boundary, real
 * plugin/session), with the compiler fake extended to model
 * `compiler.webpack.NormalModule` and `hooks.thisCompilation`.
 */
import { writeFileSync } from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadSystemModule: vi.fn(),
  analyzeProject: vi.fn(),
  clearAnalysisCache: vi.fn(),
}));

vi.mock('../src/singleton', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/singleton')>();
  return {
    ...actual,
    engineApi: () => ({
      loadSystemModule: mocks.loadSystemModule,
      extractFacts: () => '{"files":{},"parseCount":0}',
      analyzeProject: mocks.analyzeProject,
      clearAnalysisCache: mocks.clearAnalysisCache,
    }),
  };
});

import { AnimusWebpackPlugin } from '../src/plugin';
import { replacementEpochPath, sessionArtifactDir } from '../src/session-paths';
import {
  buildManifest,
  BUTTON_SHAPE_EDIT,
  BUTTON_STYLE_EDIT,
  cleanupProjects,
  createProject as createFixtureProject,
  PLAN_A,
  PLAN_B,
  resetAnimusGlobals,
  SYSTEM_CONFIG,
} from './singleton-fixtures';

import type { AnimusNextOptions } from '../src/types';

let restoreGlobals: () => void;

/** Loader path injected via the internal option so the loader-chain
 *  predicate is exercised without resolving this package's dist. */
const LOADER_PATH = '/harness/animus-loader.js';

function createProject(): string {
  return createFixtureProject('animus-needbuild-');
}

type NeedBuildFn = (
  module: unknown,
  context: unknown,
  callback: (err?: unknown, result?: boolean) => void
) => void;

/** Per-compilation needBuild recorder mirroring
 *  NormalModule.getCompilationHooks' identity contract. */
function makeFakeNormalModule() {
  const byCompilation = new Map<unknown, { taps: NeedBuildFn[] }>();
  return {
    getCompilationHooks(compilation: unknown) {
      let entry = byCompilation.get(compilation);
      if (!entry) {
        entry = { taps: [] };
        byCompilation.set(compilation, entry);
      }
      const { taps } = entry;
      return {
        needBuild: {
          tapAsync: (_name: string, fn: NeedBuildFn) => {
            taps.push(fn);
          },
        },
      };
    },
    tapsFor(compilation: unknown): NeedBuildFn[] {
      return byCompilation.get(compilation)?.taps ?? [];
    },
  };
}

type AsyncHandler = (compiler: unknown) => Promise<void>;
type CompilationHandler = (compilation: unknown) => void;

function createCompiler(
  root: string,
  extras: {
    name?: string;
    ignored?: unknown;
    omitNormalModule?: boolean;
  } = {}
) {
  const runHandlers: AsyncHandler[] = [];
  const watchRunHandlers: AsyncHandler[] = [];
  const compilationHandlers: CompilationHandler[] = [];
  const thisCompilationHandlers: CompilationHandler[] = [];
  const normalModule = makeFakeNormalModule();
  const compiler = {
    hooks: {
      run: {
        tapPromise: (_name: string, fn: AsyncHandler) => {
          runHandlers.push(fn);
        },
      },
      watchRun: {
        tapPromise: (_name: string, fn: AsyncHandler) => {
          watchRunHandlers.push(fn);
        },
      },
      compilation: {
        tap: (_name: string, fn: CompilationHandler) => {
          compilationHandlers.push(fn);
        },
      },
      thisCompilation: {
        tap: (_name: string, fn: CompilationHandler) => {
          thisCompilationHandlers.push(fn);
        },
      },
    },
    context: root,
    options: {
      name: extras.name,
      resolve: { alias: {} },
      watchOptions:
        extras.ignored === undefined ? {} : { ignored: extras.ignored },
    },
    webpack: {
      Compilation: { PROCESS_ASSETS_STAGE_ADDITIONAL: -100 },
      sources: {
        RawSource: class {
          constructor(private readonly content: string) {}
          source(): string {
            return this.content;
          }
          size(): number {
            return this.content.length;
          }
        },
      },
      ...(extras.omitNormalModule ? {} : { NormalModule: normalModule }),
    },
  };
  return {
    compiler,
    runHandlers,
    watchRunHandlers,
    compilationHandlers,
    thisCompilationHandlers,
    normalModule,
  };
}

const OPTIONS: AnimusNextOptions & { loaderPath?: string } = {
  system: './src/system.ts',
  loaderPath: LOADER_PATH,
};

function applyPlugin(
  plugin: AnimusWebpackPlugin,
  compiler: ReturnType<typeof createCompiler>['compiler']
): void {
  plugin.apply(
    compiler as unknown as Parameters<AnimusWebpackPlugin['apply']>[0]
  );
}

/** Drive one tapped needBuild fn synchronously and capture its verdict. */
function needBuildVerdict(
  fn: NeedBuildFn,
  module: unknown
): { err: unknown; forced: boolean | undefined } {
  let captured: { err: unknown; forced: boolean | undefined } | null = null;
  fn(module, {}, (err, result) => {
    captured = { err, forced: result };
  });
  expect(captured).not.toBeNull();
  return captured!;
}

const animusModule = (root: string) => ({
  resource: join(root, 'src', 'Button.tsx'),
  loaders: [{ loader: LOADER_PATH }],
});
const otherModule = (root: string) => ({
  resource: join(root, 'src', 'plain.css'),
  loaders: [{ loader: '/other/css-loader.js' }],
});

beforeEach(() => {
  restoreGlobals = resetAnimusGlobals();
  mocks.loadSystemModule.mockReset().mockReturnValue({ ...SYSTEM_CONFIG });
  mocks.analyzeProject
    .mockReset()
    .mockImplementation(() => buildManifest(PLAN_A, '.btn{margin:8px;}'));
  mocks.clearAnalysisCache.mockReset();
});

afterEach(() => {
  restoreGlobals();
  vi.restoreAllMocks();
  cleanupProjects();
});

describe('runtime existence check (design D7)', () => {
  test('apply fails loudly when NormalModule.getCompilationHooks is absent', () => {
    const root = createProject();
    const { compiler } = createCompiler(root, { omitNormalModule: true });
    expect(() =>
      applyPlugin(new AnimusWebpackPlugin(OPTIONS), compiler)
    ).toThrow(/needBuild|getCompilationHooks/);
  });

  test('the edge-server compiler is still skipped before the check', () => {
    const root = createProject();
    const { compiler } = createCompiler(root, {
      name: 'edge-server',
      omitNormalModule: true,
    });
    expect(() =>
      applyPlugin(new AnimusWebpackPlugin(OPTIONS), compiler)
    ).not.toThrow();
  });
});

describe('watchOptions.ignored gains the session epoch artifact path (design D2)', () => {
  /** The session-scoped epoch path a plugin instance derives (identity is
   *  process-claimed, so every in-process instance derives the same one). */
  const epochPathFor = (root: string, plugin: AnimusWebpackPlugin): string =>
    replacementEpochPath(sessionArtifactDir(root, plugin.sessionId));

  test('absent ignored becomes a one-element array', () => {
    const root = createProject();
    const { compiler } = createCompiler(root);
    const plugin = new AnimusWebpackPlugin(OPTIONS);
    applyPlugin(plugin, compiler);
    expect(compiler.options.watchOptions).toEqual({
      ignored: [epochPathFor(root, plugin)],
    });
  });

  test('a string shape is preserved alongside the epoch path', () => {
    const root = createProject();
    const { compiler } = createCompiler(root, { ignored: '**/custom/**' });
    const plugin = new AnimusWebpackPlugin(OPTIONS);
    applyPlugin(plugin, compiler);
    expect(compiler.options.watchOptions.ignored).toEqual([
      '**/custom/**',
      epochPathFor(root, plugin),
    ]);
  });

  test('an array shape is appended exactly once across compilers', () => {
    const root = createProject();
    const { compiler } = createCompiler(root, { ignored: ['**/custom/**'] });
    const first = new AnimusWebpackPlugin(OPTIONS);
    const second = new AnimusWebpackPlugin(OPTIONS);
    applyPlugin(first, compiler);
    applyPlugin(second, compiler);
    // Both instances share the process-claimed session, so the appended
    // path dedupes across compilers.
    expect(second.sessionId).toBe(first.sessionId);
    expect(compiler.options.watchOptions.ignored).toEqual([
      '**/custom/**',
      epochPathFor(root, first),
    ]);
  });

  test('a RegExp shape composes into a matcher that keeps both behaviors', () => {
    const root = createProject();
    const userIgnore = /node_modules/;
    const { compiler } = createCompiler(root, { ignored: userIgnore });
    const plugin = new AnimusWebpackPlugin(OPTIONS);
    applyPlugin(plugin, compiler);
    const ignored = compiler.options.watchOptions.ignored as (
      path: string
    ) => boolean;
    expect(typeof ignored).toBe('function');
    expect(ignored(epochPathFor(root, plugin))).toBe(true);
    expect(ignored('/proj/node_modules/x.js')).toBe(true);
    expect(ignored(join(root, 'src', 'Button.tsx'))).toBe(false);
  });
});

describe('epoch-driven needBuild fan-out (design D1)', () => {
  test('shape edit forces animus-loader-chain modules in the next compilation; style edit and cold start do not', async () => {
    const root = createProject();
    const harness = createCompiler(root);
    applyPlugin(new AnimusWebpackPlugin(OPTIONS), harness.compiler);

    // Cold start: first watchRun runs the full pipeline; the fan-out is
    // NEVER armed by initialization (restart coherence belongs to the disk
    // witness, not a whole-graph rebuild).
    await harness.watchRunHandlers[0](harness.compiler);
    const c1 = {};
    harness.thisCompilationHandlers.forEach((fn) => fn(c1));
    const c1Taps = harness.normalModule.tapsFor(c1);
    expect(c1Taps.length).toBe(1);
    expect(needBuildVerdict(c1Taps[0], animusModule(root))).toEqual({
      err: undefined,
      forced: undefined,
    });

    // Style-value-only edit: plans identical → epoch unchanged → no force.
    mocks.analyzeProject.mockImplementation(() =>
      buildManifest(PLAN_A, '.btn{margin:16px;}')
    );
    writeFileSync(join(root, 'src', 'Button.tsx'), BUTTON_STYLE_EDIT);
    await harness.watchRunHandlers[0]({
      ...harness.compiler,
      modifiedFiles: new Set([join(root, 'src', 'Button.tsx')]),
      removedFiles: new Set<string>(),
    });
    const c2 = {};
    harness.thisCompilationHandlers.forEach((fn) => fn(c2));
    expect(
      needBuildVerdict(harness.normalModule.tapsFor(c2)[0], animusModule(root))
    ).toEqual({ err: undefined, forced: undefined });

    // Shape edit: plans change → epoch moves → every animus-loader-chain
    // module is forced in the triggering compilation; others untouched.
    mocks.analyzeProject.mockImplementation(() =>
      buildManifest(PLAN_B, '.btn{margin:16px;}')
    );
    writeFileSync(join(root, 'src', 'Button.tsx'), BUTTON_SHAPE_EDIT);
    await harness.watchRunHandlers[0]({
      ...harness.compiler,
      modifiedFiles: new Set([join(root, 'src', 'Button.tsx')]),
      removedFiles: new Set<string>(),
    });
    const c3 = {};
    harness.thisCompilationHandlers.forEach((fn) => fn(c3));
    const c3Taps = harness.normalModule.tapsFor(c3);
    expect(needBuildVerdict(c3Taps[0], animusModule(root))).toEqual({
      err: null,
      forced: true,
    });
    expect(needBuildVerdict(c3Taps[0], otherModule(root))).toEqual({
      err: undefined,
      forced: undefined,
    });

    // The arm is captured per compilation: a follow-up compilation in the
    // same session (no new watchRun transaction) is NOT forced.
    const c4 = {};
    harness.thisCompilationHandlers.forEach((fn) => fn(c4));
    expect(
      needBuildVerdict(harness.normalModule.tapsFor(c4)[0], animusModule(root))
    ).toEqual({ err: undefined, forced: undefined });
  });

  test('a joining compiler that built the previous epoch is also fanned out', async () => {
    const root = createProject();
    const owner = createCompiler(root);
    const follower = createCompiler(root, { name: 'server' });
    applyPlugin(new AnimusWebpackPlugin(OPTIONS), owner.compiler);
    applyPlugin(new AnimusWebpackPlugin(OPTIONS), follower.compiler);

    await owner.watchRunHandlers[0](owner.compiler);
    await follower.watchRunHandlers[0](follower.compiler);

    // Shape edit lands; the owner runs the transaction to completion
    // BEFORE the follower's watchRun even enters (the late-compiler case).
    mocks.analyzeProject.mockImplementation(() =>
      buildManifest(PLAN_B, '.btn{margin:16px;}')
    );
    writeFileSync(join(root, 'src', 'Button.tsx'), BUTTON_SHAPE_EDIT);
    await owner.watchRunHandlers[0]({
      ...owner.compiler,
      modifiedFiles: new Set([join(root, 'src', 'Button.tsx')]),
      removedFiles: new Set<string>(),
    });
    await follower.watchRunHandlers[0]({
      ...follower.compiler,
      modifiedFiles: new Set([join(root, 'src', 'Button.tsx')]),
      removedFiles: new Set<string>(),
    });

    const followerCompilation = {};
    follower.thisCompilationHandlers.forEach((fn) => fn(followerCompilation));
    expect(
      needBuildVerdict(
        follower.normalModule.tapsFor(followerCompilation)[0],
        animusModule(root)
      )
    ).toEqual({ err: null, forced: true });
  });
});
