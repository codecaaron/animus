// @vitest-environment node
/**
 * External workspace-source ingestion under the exact compiled webpack of
 * each Next fixture (openspec: external-source-watch-ingestion, increment
 * 02 — design D3; spec workspace-source-ingestion, "Unimported kit
 * creation is ingested").
 *
 * The decisive probe-proven behavior: webpack does not watch unimported
 * files, so a file created in a declared kit reaches analysis ONLY through
 * the kit root's registration as a compilation context dependency — the
 * watcher then reports the DIRECTORY, and the session's root-dirty rewalk
 * reconstructs the creation. Engine canned at the singleton seam; the real
 * AnimusWebpackPlugin, loader, and session run throughout.
 */
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
  scanKeyframesExports: vi.fn(),
}));

import { setEngineApiOverride } from '../../../extract/session/singleton';

// Engine API injection through the singleton's globalThis-keyed test
// seam — reaches every copy of the module (source or dist, and the
// loader's CJS require inside webpack), which a module mock cannot.
setEngineApiOverride(() => ({
  extractFacts: () => '{"files":{},"parseCount":0}',
  loadSystemModule: mocks.loadSystemModule,
  analyzeProject: mocks.analyzeProject,
  clearAnalysisCache: mocks.clearAnalysisCache,
  transformFile: mocks.transformFile,
  scanKeyframesExports: mocks.scanKeyframesExports,
}));

import animusLoader from '../../src/loader';
import { AnimusWebpackPlugin } from '../../src/plugin';
import {
  armCannedEngine,
  backdateTree,
  buildGauntletConfig as buildConfig,
  createGauntletProject,
  createWatchState,
  installLoaderRecorder,
  loadFixtureWebpack,
  LOADER_IMPL_KEY,
  resetAnimusGlobals,
  runWatchSession,
  writeLoaderShim,
} from './harness';
import { probeFixtureWebpack, WEBPACK_FIXTURES } from './prerequisites';

import type { GauntletProject, WatchState } from './harness';
import type { JsonValue } from '@animus-ui/assertions';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const disposers: Array<() => void> = [];

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  Reflect.deleteProperty(globalThis, LOADER_IMPL_KEY);
  resetAnimusGlobals();
  vi.restoreAllMocks();
});

/** Suite arming: the shared canned engine plus this suite's
 *  scanKeyframesExports mock. */
function armSuiteEngine(): void {
  armCannedEngine(mocks, () => {
    mocks.scanKeyframesExports.mockReset().mockReturnValue(null);
  });
}

/** Everything one external-workspace scenario drives its watch session with. */
interface ExternalProjectSetup {
  project: GauntletProject;
  kitRoot: string;
  state: WatchState;
  plugin: AnimusWebpackPlugin;
  shimPath: string;
}

function setUpExternalProject(): ExternalProjectSetup {
  resetAnimusGlobals();
  armSuiteEngine();
  const project = createGauntletProject();
  disposers.push(() => project.dispose());

  // The kit lives OUTSIDE the project root (sibling temp dir) — the
  // monorepo workspace shape.
  const kitRoot = realpathSync(mkdtempSync(join(tmpdir(), 'animus-kit-')));
  disposers.push(() => rmSync(kitRoot, { recursive: true, force: true }));
  writeFileSync(join(kitRoot, 'package.json'), '{"name":"@gauntlet/kit"}');
  mkdirSync(join(kitRoot, 'src'), { recursive: true });
  writeFileSync(join(kitRoot, 'src', 'index.js'), "module.exports = 'kit';\n");
  writeFileSync(join(kitRoot, 'src', 'card.js'), "module.exports = 'card';\n");

  // Declare the kit from the system file. The canned loadSystemModule never
  // reads it — extractSystemFilePackages (real) does.
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

// ── analyzeProject payload boundary ───────────────────────────────────────
// The engine's first positional argument crosses the NAPI seam as JSON text,
// so the recorded call is decoded here rather than asserted through casts.

/** One entry of the analyzed universe the engine received. */
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

/** All analyzed file sets, parsed from every analyzeProject call. */
function analyzedFileSets(): AnalyzedFile[][] {
  return mocks.analyzeProject.mock.calls.map((call) =>
    parseAnalyzedFiles(call[0])
  );
}

for (const fixture of WEBPACK_FIXTURES) {
  const prereq = probeFixtureWebpack(fixture.id);

  describe.skipIf(!prereq.ok)(`external ingestion [${fixture.id}]`, () => {
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
        // The kit tree is a deliberate external watch surface — the
        // context-dependency turn under test rides its directory events.
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

      // Cold discovery ingested the declared kit.
      const sets = analyzedFileSets();
      expect(sets.length).toBeGreaterThanOrEqual(1);
      const cardKey = relative(project.root, join(kitRoot, 'src', 'card.js'));
      expect(sets[0].some((f) => f.path === cardKey)).toBe(true);

      // The UNIMPORTED create produced a watch turn at all — without the
      // kit root as a compilation context dependency webpack has no watch
      // input covering it and the session never runs again.
      expect(records.length).toBeGreaterThanOrEqual(2);
      const kitTurn = records
        .slice(1)
        .find((r) =>
          r.modifiedFiles.some(
            (f) => f === join(kitRoot, 'src') || f.startsWith(kitRoot + sep)
          )
        );
      expect(kitTurn).toBeDefined();

      // The analyzed universe gained the file from its watch signal alone.
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
  });
}
