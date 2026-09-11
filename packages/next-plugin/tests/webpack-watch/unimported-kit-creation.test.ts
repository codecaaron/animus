// @vitest-environment node
import { isJsonObject, isJsonString } from '@animus-ui/assertions';
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join, relative, sep } from 'path';
import { afterEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadSystemModule: vi.fn(),
  analyzeProject: vi.fn(),
  clearAnalysisCache: vi.fn(),
  transformFile: vi.fn(),
}));

import { setEngineApiOverride } from '../../../extract/session/singleton';

setEngineApiOverride(() => ({
  extractFacts: () => '{"files":{},"parseCount":0}',
  loadSystemModule: mocks.loadSystemModule,
  analyzeProject: mocks.analyzeProject,
  clearAnalysisCache: mocks.clearAnalysisCache,
  transformFile: mocks.transformFile,
}));

import animusLoader from '../../src/loader';
import { AnimusWebpackPlugin } from '../../src/plugin';
import { probeFixtureWebpack, WEBPACK_FIXTURES } from './prerequisites';
import {
  armCannedEngine,
  backdateTree,
  buildHarnessWebpackConfig as buildConfig,
  createHarnessProject,
  createWatchState,
  installLoaderRecorder,
  loadFixtureWebpack,
  LOADER_IMPL_KEY,
  resetAnimusGlobals,
  runWatchSession,
  writeLoaderShim,
} from './watch-session';

import type { HarnessProject, WatchState } from './watch-session';
import type { JsonValue } from '@animus-ui/assertions';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const disposers: Array<() => void> = [];

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  Reflect.deleteProperty(globalThis, LOADER_IMPL_KEY);
  resetAnimusGlobals();
  vi.restoreAllMocks();
});

function armSuiteEngine(): void {
  armCannedEngine(mocks, () => {});
}

interface ExternalProjectSetup {
  project: HarnessProject;
  kitRoot: string;
  state: WatchState;
  plugin: AnimusWebpackPlugin;
  shimPath: string;
}

function setUpExternalProject(): ExternalProjectSetup {
  resetAnimusGlobals();
  armSuiteEngine();
  const project = createHarnessProject();
  disposers.push(() => project.dispose());

  const kitRoot = realpathSync(mkdtempSync(join(tmpdir(), 'animus-kit-')));
  disposers.push(() => rmSync(kitRoot, { recursive: true, force: true }));
  writeFileSync(join(kitRoot, 'package.json'), '{"name":"@harness/kit"}');
  mkdirSync(join(kitRoot, 'src'), { recursive: true });
  writeFileSync(join(kitRoot, 'src', 'index.js'), "module.exports = 'kit';\n");
  writeFileSync(join(kitRoot, 'src', 'card.js'), "module.exports = 'card';\n");

  // The canned loadSystemModule never reads this file; the real
  // extractSystemFilePackages does, and that is what declares the kit.
  project.write(
    'src/system.ts',
    `import { createSystem } from '@animus-ui/system';\n` +
      `import kit from '${join(kitRoot, 'src', 'index.js')}';\n` +
      `export const system = createSystem({}).extend(kit);\n`
  );

  const shimPath = writeLoaderShim(project.root);
  const state = createWatchState();
  installLoaderRecorder(project.root, state, animusLoader);
  const plugin = new AnimusWebpackPlugin({
    system: './src/system.ts',
    loaderPath: shimPath,
  });
  project.backdateAll();
  backdateTree(kitRoot);
  return { project, kitRoot, state, plugin, shimPath };
}

interface AnalyzedFile {
  path: string;
  source: string;
}

function parseAnalyzedFiles(filesJson: string): AnalyzedFile[] {
  const candidate: JsonValue = JSON.parse(filesJson);
  if (!Array.isArray(candidate)) {
    throw new TypeError('analyzeProject filesJson must be an array');
  }
  return candidate.map((file, index) => {
    if (
      !isJsonObject(file) ||
      !isJsonString(file.path) ||
      !isJsonString(file.source)
    ) {
      throw new TypeError(`analyzeProject file ${index} is malformed`);
    }
    return { path: file.path, source: file.source };
  });
}

function analyzedFileSets(): AnalyzedFile[][] {
  return mocks.analyzeProject.mock.calls.map((call) =>
    parseAnalyzedFiles(call[0])
  );
}

for (const fixture of WEBPACK_FIXTURES) {
  const prereq = probeFixtureWebpack(fixture.id);

  describe.skipIf(!prereq.ok)(
    `unimported kit creation is analyzed [${fixture.id}]`,
    () => {
      test(`prerequisites present${prereq.ok ? '' : ` — SKIPPED: ${prereq.reason}`}`, () => {
        expect(prereq.ok).toBe(true);
      });

      test('an unimported kit creation reaches analysis via the context-dependency watch turn', async () => {
        const webpack = loadFixtureWebpack(fixture.webpackPath);
        const { project, kitRoot, state, plugin, shimPath } =
          setUpExternalProject();

        const records = await runWatchSession({
          webpack,
          root: project.root,
          config: buildConfig({
            root: project.root,
            shimPath,
            plugins: [plugin],
          }),
          watchRoots: [kitRoot],
          state,
          steps: [
            () =>
              writeFileSync(
                join(kitRoot, 'src', 'newcomer.js'),
                "module.exports = 'newcomer';\n"
              ),
          ],
          settleMs: 1500,
        });

        const sets = analyzedFileSets();
        expect(sets.length).toBeGreaterThanOrEqual(1);
        const cardKey = relative(project.root, join(kitRoot, 'src', 'card.js'));
        expect(sets[0].some((f) => f.path === cardKey)).toBe(true);

        expect(records.length).toBeGreaterThanOrEqual(2);
        const kitTurn = records
          .slice(1)
          .find((r) =>
            r.modifiedFiles.some(
              (f) => f === join(kitRoot, 'src') || f.startsWith(kitRoot + sep)
            )
          );
        expect(kitTurn).toBeDefined();

        const newcomerKey = relative(
          project.root,
          join(kitRoot, 'src', 'newcomer.js')
        );
        expect(
          analyzedFileSets().some((files) =>
            files.some(
              (f) => f.path === newcomerKey && f.source.includes('newcomer')
            )
          )
        ).toBe(true);
      });
    }
  );
}
