import { writeFileSync } from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadSystemModule: vi.fn(),
  analyzeProject: vi.fn(),
  clearAnalysisCache: vi.fn(),
}));

import { setEngineApiOverride } from '../../extract/session/singleton';

setEngineApiOverride(() => ({
  extractFacts: () => '{"files":{},"parseCount":0}',
  loadSystemModule: mocks.loadSystemModule,
  analyzeProject: mocks.analyzeProject,
  clearAnalysisCache: mocks.clearAnalysisCache,
}));

import {
  replacementEpochPath,
  sessionArtifactDir,
} from '../../extract/session/session-paths';
import {
  buildManifest,
  BUTTON_STYLE_EDIT,
  createProject as createFixtureProject,
  disposeTempRoots,
  PLAN_A,
  PLAN_B,
  resetAnimusGlobals,
  SYSTEM_CONFIG,
} from '../../extract/tests/session/session-fixtures';
import { AnimusWebpackPlugin } from '../src/plugin';

import type { AnimusNextOptions } from '../src/types';

let restoreGlobals: () => void;

const LOADER_PATH = '/harness/animus-loader.js';
const BUTTON_VARIANT_EDIT =
  "export const Button = animus.styles({ margin: 16 }).variant({}).asElement('button');\n";

function createProject(): string {
  return createFixtureProject('animus-needbuild-');
}

interface CandidateModule {
  resource: string;
  loaders: Array<{ loader: string }>;
}

type NeedBuildContext = Record<never, never>;
type NeedBuildError = Error | null | undefined;
type NeedBuildFn = (
  module: CandidateModule,
  context: NeedBuildContext,
  callback: (err?: Error | null, result?: boolean) => void
) => void;

type CompilationIdentity = Record<never, never>;

interface FakeNormalModule {
  getCompilationHooks(compilation: CompilationIdentity): {
    needBuild?: {
      tapAsync(name: string, fn: NeedBuildFn): void;
    };
  };
}

function makeFakeNormalModule() {
  const byCompilation = new Map<CompilationIdentity, { taps: NeedBuildFn[] }>();
  return {
    getCompilationHooks(compilation: CompilationIdentity) {
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
    tapsFor(compilation: CompilationIdentity): NeedBuildFn[] {
      return byCompilation.get(compilation)?.taps ?? [];
    },
  };
}

type WatchIgnoreMatcher = (path: string) => boolean;
type WatchIgnore = string | string[] | RegExp | WatchIgnoreMatcher;

type AsyncHandler = (compiler: TestCompiler) => Promise<void>;
type CompilationHandler = (compilation: CompilationIdentity) => void;

interface TestWebpack {
  Compilation: { PROCESS_ASSETS_STAGE_ADDITIONAL: number };
  sources: {
    RawSource: new (content: string) => {
      source(): string;
      size(): number;
    };
  };
  NormalModule?: FakeNormalModule;
}

interface TestCompiler {
  hooks: {
    run: { tapPromise(name: string, fn: AsyncHandler): void };
    watchRun: { tapPromise(name: string, fn: AsyncHandler): void };
    compilation: { tap(name: string, fn: CompilationHandler): void };
    thisCompilation: { tap(name: string, fn: CompilationHandler): void };
  };
  context: string;
  options: {
    name?: string;
    resolve: { alias: Record<string, string> };
    watchOptions: { ignored?: WatchIgnore };
  };
  webpack: TestWebpack;
  modifiedFiles?: ReadonlySet<string>;
  removedFiles?: ReadonlySet<string>;
}

function createCompiler(
  root: string,
  extras: {
    name?: string;
    ignored?: WatchIgnore;
    omitNormalModule?: boolean;
  } = {}
) {
  const runHandlers: AsyncHandler[] = [];
  const watchRunHandlers: AsyncHandler[] = [];
  const compilationHandlers: CompilationHandler[] = [];
  const thisCompilationHandlers: CompilationHandler[] = [];
  const normalModule = makeFakeNormalModule();
  const webpack: TestWebpack = {
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
  };
  if (!extras.omitNormalModule) {
    webpack.NormalModule = normalModule;
  }
  const compiler: TestCompiler = {
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
    webpack,
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
  compiler: TestCompiler
): void {
  // SAFETY: TestCompiler models every compiler field apply() reads; the
  // registered asset-compilation callback is never invoked here.
  plugin.apply(compiler as Parameters<AnimusWebpackPlugin['apply']>[0]);
}

function needBuildVerdict(
  fn: NeedBuildFn,
  module: CandidateModule
): { err: NeedBuildError; forced: boolean | undefined } {
  let captured: {
    err: NeedBuildError;
    forced: boolean | undefined;
  } | null = null;
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

function requireWatchIgnoreMatcher(compiler: TestCompiler): WatchIgnoreMatcher {
  const ignored = compiler.options.watchOptions.ignored;
  expect(ignored).toBeTypeOf('function');
  // SAFETY: The runtime assertion establishes the matcher contract produced
  // when apply() normalizes this harness's RegExp watch-ignore fixture.
  return ignored as WatchIgnoreMatcher;
}

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
  disposeTempRoots();
});

describe('runtime existence check (design D7)', () => {
  test('apply fails loudly when NormalModule.getCompilationHooks is absent', () => {
    const root = createProject();
    const { compiler } = createCompiler(root, { omitNormalModule: true });
    expect(() =>
      applyPlugin(new AnimusWebpackPlugin(OPTIONS), compiler)
    ).toThrow(/needBuild|getCompilationHooks/);
  });

  test('a compilation whose hooks omit needBuild fails loudly', () => {
    const root = createProject();
    const harness = createCompiler(root);
    harness.compiler.webpack.NormalModule = {
      getCompilationHooks: () => ({}),
    };
    applyPlugin(new AnimusWebpackPlugin(OPTIONS), harness.compiler);
    expect(() =>
      harness.thisCompilationHandlers.forEach((fn) => fn({}))
    ).toThrow(/needBuild/);
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

describe('watchOptions.ignored gains the replacements-epoch artifact path (design D2)', () => {
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
    expect(second.sessionId).toBe(first.sessionId);
    expect(compiler.options.watchOptions.ignored).toEqual([
      '**/custom/**',
      epochPathFor(root, first),
    ]);
  });

  test('a matcher shape composes into a matcher that keeps both behaviors', () => {
    const root = createProject();
    const userIgnore: WatchIgnoreMatcher = (path) => path.includes('vendor');
    const { compiler } = createCompiler(root, { ignored: userIgnore });
    const plugin = new AnimusWebpackPlugin(OPTIONS);
    applyPlugin(plugin, compiler);
    const ignored = requireWatchIgnoreMatcher(compiler);
    expect(ignored(epochPathFor(root, plugin))).toBe(true);
    expect(ignored('/proj/vendor/x.js')).toBe(true);
    expect(ignored(join(root, 'src', 'Button.tsx'))).toBe(false);
  });

  test('a RegExp shape composes into a matcher that keeps both behaviors', () => {
    const root = createProject();
    const userIgnore = /node_modules/;
    const { compiler } = createCompiler(root, { ignored: userIgnore });
    const plugin = new AnimusWebpackPlugin(OPTIONS);
    applyPlugin(plugin, compiler);
    const ignored = requireWatchIgnoreMatcher(compiler);
    expect(ignored(epochPathFor(root, plugin))).toBe(true);
    expect(ignored('/proj/node_modules/x.js')).toBe(true);
    expect(ignored(join(root, 'src', 'Button.tsx'))).toBe(false);
  });
});

describe('needBuild fan-out after a replacements-epoch move (design D1)', () => {
  test('shape edit forces animus-loader-chain modules in the next compilation; style edit and cold start do not', async () => {
    const root = createProject();
    const harness = createCompiler(root);
    applyPlugin(new AnimusWebpackPlugin(OPTIONS), harness.compiler);

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
    writeFileSync(join(root, 'src', 'Button.tsx'), BUTTON_VARIANT_EDIT);
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

    mocks.analyzeProject.mockImplementation(() =>
      buildManifest(PLAN_B, '.btn{margin:16px;}')
    );
    writeFileSync(join(root, 'src', 'Button.tsx'), BUTTON_VARIANT_EDIT);
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
