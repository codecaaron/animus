import { mkdirSync, realpathSync, writeFileSync } from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { nativeFunctions } from '../../extract/tests/native-functions';

const mocks = vi.hoisted(() => ({
  loadSystemModule: vi.fn(),
  analyzeProject: vi.fn<EngineApi['analyzeProject']>(),
  clearAnalysisCache: vi.fn(),
}));

import { setEngineApiOverride } from '../../extract/session/singleton';

setEngineApiOverride(() => ({
  ...nativeFunctions(),
  loadSystemModule: mocks.loadSystemModule,
  extractModuleFacts: () => '{"files":{},"parseCount":0}',
  resolveSpecifier: requireResolveSpecifier,
  analyzeProject: mocks.analyzeProject,
  clearAnalysisCache: mocks.clearAnalysisCache,
}));

import {
  buildManifest,
  createProject,
  disposeTempRoots,
  lastAnalyzedPaths,
  requireResolveSpecifier,
  resetAnimusGlobals,
  SYSTEM_CONFIG,
} from '../../extract/tests/session/session-fixtures';
import { AnimusWebpackPlugin } from '../src/plugin';
import { withAnimus } from '../src/with-animus';

import type { EngineApi } from '../../extract/pipeline';

let restoreGlobals: () => void;
let savedCwd: string;

beforeEach(() => {
  restoreGlobals = resetAnimusGlobals();
  savedCwd = process.cwd();
  mocks.loadSystemModule.mockReset().mockReturnValue({ ...SYSTEM_CONFIG });
  mocks.analyzeProject.mockReset().mockImplementation(() => buildManifest({}));
  mocks.clearAnalysisCache.mockReset();
});

afterEach(() => {
  process.chdir(savedCwd);
  restoreGlobals();
  vi.restoreAllMocks();
  disposeTempRoots();
});

/** A project whose custom `distDir` already holds Next's output; with
 *  `kitInOutput`, a kit there that the system extends. */
function projectWithOutput(kitInOutput = false): string {
  // Realpath'd: macOS resolves `/var` through a symlink, and collection
  // spells a package's files from the resolved path.
  const root = realpathSync(createProject('animus-next-output-'));
  mkdirSync(join(root, 'build', 'static'), { recursive: true });
  writeFileSync(join(root, 'build', 'static', 'page.js'), 'export {};\n');
  if (kitInOutput) {
    mkdirSync(join(root, 'build', 'kit', 'src'), { recursive: true });
    writeFileSync(
      join(root, 'build', 'kit', 'package.json'),
      '{"name":"@out/kit"}'
    );
    writeFileSync(
      join(root, 'build', 'kit', 'src', 'index.ts'),
      'export const Kit = 1;\n'
    );
    writeFileSync(
      join(root, 'src', 'system.ts'),
      `import { createSystem } from '@animus-ui/system';
import kit from '../build/kit/src/index.ts';
export const system = createSystem({}).extend(kit);
`
    );
  }
  return root;
}

const outputAnalyzed = () =>
  lastAnalyzedPaths(mocks.analyzeProject).filter((path) =>
    path.startsWith('build/')
  );

type PluginCompiler = Parameters<AnimusWebpackPlugin['apply']>[0];
type AsyncHandler = Parameters<PluginCompiler['hooks']['run']['tapPromise']>[1];

describe('a user exclude list never re-admits output', () => {
  test.each([
    ["webpack keeps Next's distDir out of discovery", false],
    ['webpack never collects a package inside the distDir', true],
  ])('%s', async (_label, kitInOutput) => {
    const root = projectWithOutput(kitInOutput);
    const wrapped = withAnimus({
      system: './src/system.ts',
      root,
      exclude: ['stories'],
    })({ distDir: 'build' });
    if (!('webpack' in wrapped)) {
      throw new Error('withAnimus returned the Turbopack branch');
    }
    const plugin = wrapped
      .webpack({}, { dev: false, dir: root })
      .plugins?.find(
        (candidate): candidate is AnimusWebpackPlugin =>
          candidate instanceof AnimusWebpackPlugin
      );
    if (plugin === undefined)
      throw new Error('no AnimusWebpackPlugin injected');
    const runHandlers: AsyncHandler[] = [];
    const compiler: PluginCompiler = {
      hooks: {
        run: { tapPromise: (_name, fn) => runHandlers.push(fn) },
        watchRun: { tapPromise: () => {} },
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
    for (const handler of runHandlers) await handler(compiler);

    expect(lastAnalyzedPaths(mocks.analyzeProject)).toContain('src/Button.tsx');
    expect(outputAnalyzed()).toEqual([]);
  });

  test("Turbopack keeps Next's distDir out of discovery", async () => {
    process.chdir(projectWithOutput());
    const config = withAnimus({
      system: './src/system.ts',
      exclude: ['stories'],
      turbopack: { mode: 'on' },
    })({ distDir: 'build' });
    if ('webpack' in config) {
      throw new Error('withAnimus returned the webpack branch');
    }

    await config('phase-production-build');

    expect(lastAnalyzedPaths(mocks.analyzeProject)).toContain('src/Button.tsx');
    expect(outputAnalyzed()).toEqual([]);
  });
});
