// @vitest-environment node
import { readFileSync, writeFileSync } from 'fs';
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

import { replacementEpochPath } from '../../../extract/session/session-paths';
import { getSessionArtifactDir } from '../../../extract/session/singleton';
import animusLoader from '../../src/loader';
import { AnimusWebpackPlugin } from '../../src/plugin';
import { probeFixtureWebpack, WEBPACK_FIXTURES } from './prerequisites';
import {
  armCannedEngine,
  buildHarnessWebpackConfig as buildConfig,
  bundleMarker,
  CHILD_REL,
  createHarnessProject,
  createWatchState,
  entrySource,
  epochHygieneViolations,
  installLoaderRecorder,
  loadFixtureWebpack,
  LOADER_IMPL_KEY,
  NEWCOMER_REL,
  newcomerChainSource,
  newcomerRawSource,
  PARENT_REL,
  parentSource,
  resetAnimusGlobals,
  runsFor,
  runWatchSession,
  turnEvidence,
  writeLoaderShim,
} from './watch-session';

import type { HarnessProject, WatchState } from './watch-session';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const disposers: Array<() => void> = [];

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  Reflect.deleteProperty(globalThis, LOADER_IMPL_KEY);
  resetAnimusGlobals();
  vi.restoreAllMocks();
});

interface DifferentialProjectSetup {
  project: HarnessProject;
  state: WatchState;
  plugin: AnimusWebpackPlugin;
  shimPath: string;
}

function setUpProject(entryModules?: string[]): DifferentialProjectSetup {
  resetAnimusGlobals();
  armCannedEngine(mocks);
  const project = createHarnessProject({ entryModules });
  disposers.push(() => project.dispose());
  const shimPath = writeLoaderShim(project.root);
  const state = createWatchState();
  disposers.push(installLoaderRecorder(project.root, state, animusLoader));
  const plugin = new AnimusWebpackPlugin({
    system: './src/system.ts',
    loaderPath: shimPath,
  });
  return { project, state, plugin, shimPath };
}

for (const fixture of WEBPACK_FIXTURES) {
  const prereq = probeFixtureWebpack(fixture.id);

  describe.skipIf(!prereq.ok)(
    `shape edit rebuilds descendants in the same compilation [${fixture.id}]`,
    () => {
      test(`prerequisites present${prereq.ok ? '' : ` — SKIPPED: ${prereq.reason}`}`, () => {
        expect(prereq.ok).toBe(true);
      });

      test('P0: a cold animus module snapshot contains the epoch artifact', async () => {
        const webpack = loadFixtureWebpack(fixture.webpackPath);
        const { project, state, plugin, shimPath } = setUpProject();
        project.backdateAll();

        const records = await runWatchSession({
          webpack,
          root: project.root,
          config: buildConfig({
            root: project.root,
            shimPath,
            plugins: [plugin],
          }),
          state,
          steps: [],
        });

        const evidence = turnEvidence(records);
        expect(evidence, JSON.stringify(evidence, null, 2)).toHaveLength(1);
        expect(records[0].errors).toEqual([]);
        expect(records[0].hasErrors).toBe(false);
        const sessionEpochPath = replacementEpochPath(getSessionArtifactDir()!);
        const childDeps = records[0].moduleFileDependencies.get(CHILD_REL);
        expect(childDeps).toBeDefined();
        expect(childDeps).toContain(sessionEpochPath);
        expect(bundleMarker(records[0].bundle, CHILD_REL)).toBe('child@G0');
      });

      test('N0: a style-value-only edit re-runs zero sibling loaders and writes no epoch bytes', async () => {
        const webpack = loadFixtureWebpack(fixture.webpackPath);
        const { project, state, plugin, shimPath } = setUpProject();
        project.backdateAll();

        // Webpack snapshots the freshly created epoch artifact "too new", so
        // the first edit rebuilds every animus module; c2 absorbs that.
        const records = await runWatchSession({
          webpack,
          root: project.root,
          config: buildConfig({
            root: project.root,
            shimPath,
            plugins: [plugin],
          }),
          state,
          steps: [
            () => project.write(PARENT_REL, parentSource('G0', 'S1')),
            () => project.write(PARENT_REL, parentSource('G0', 'S2')),
          ],
        });

        const n0Evidence = JSON.stringify(turnEvidence(records), null, 2);
        expect(records.length, n0Evidence).toBeGreaterThanOrEqual(3);
        expect(records.length, n0Evidence).toBeLessThanOrEqual(5);
        const measured = records.slice(2);
        expect(measured.some((r) => runsFor(r, PARENT_REL).length > 0)).toBe(
          true
        );
        for (const record of measured) {
          expect(record.errors).toEqual([]);
          expect(record.hasErrors).toBe(false);
          expect(runsFor(record, CHILD_REL)).toHaveLength(0);
        }
        const final = records[records.length - 1];
        expect(bundleMarker(final.bundle, CHILD_REL)).toBe('child@G0');
        expect(
          epochHygieneViolations(
            records,
            replacementEpochPath(getSessionArtifactDir()!)
          )
        ).toEqual([]);
      });

      test('P1: a shape edit rebuilds the descendant in the SAME compilation, first publication fresh, no echo, modifiedFiles excludes the epoch', async () => {
        const webpack = loadFixtureWebpack(fixture.webpackPath);
        const { project, state, plugin, shimPath } = setUpProject();
        project.backdateAll();

        const records = await runWatchSession({
          webpack,
          root: project.root,
          config: buildConfig({
            root: project.root,
            shimPath,
            plugins: [plugin],
          }),
          state,
          steps: [
            () => project.write(PARENT_REL, parentSource('G0', 'S1')),
            () => project.write(PARENT_REL, parentSource('G1', 'S1')),
          ],
        });

        const p1Evidence = JSON.stringify(turnEvidence(records), null, 2);
        expect(records.length, p1Evidence).toBeGreaterThanOrEqual(3);
        expect(records.length, p1Evidence).toBeLessThanOrEqual(5);
        const afterAbsorb = records.slice(2);
        const fanOuts = afterAbsorb.filter(
          (r) => runsFor(r, CHILD_REL).length > 0
        );
        expect(fanOuts, p1Evidence).toHaveLength(1);
        const fanOut = fanOuts[0];
        expect(fanOut.hasErrors).toBe(false);
        expect(runsFor(fanOut, CHILD_REL)).toHaveLength(1);
        expect(
          fanOut.modifiedFiles.some((f) => f.endsWith(`${sep}parent.js`))
        ).toBe(true);
        expect(bundleMarker(fanOut.bundle, PARENT_REL)).toBe('parent@G1');
        expect(bundleMarker(fanOut.bundle, CHILD_REL)).toBe('child@G1');
        expect(
          epochHygieneViolations(
            records,
            replacementEpochPath(getSessionArtifactDir()!)
          )
        ).toEqual([]);
      });

      test('N1, control: a deliberately late epoch write without needBuild publishes stale same-compilation output', async () => {
        const webpack = loadFixtureWebpack(fixture.webpackPath);
        resetAnimusGlobals();
        const project = createHarnessProject({
          entryModules: ['src/a.js', 'src/b.js'],
        });
        disposers.push(() => project.dispose());
        project.write('src/a.js', "module.exports = 'a0';\n");
        project.write('src/b.js', "module.exports = 'b0';\n");
        project.write('epoch.txt', 'E0');
        const shimPath = writeLoaderShim(project.root);
        const state = createWatchState();
        Reflect.set(
          globalThis,
          LOADER_IMPL_KEY,
          function (
            this: {
              resourcePath: string;
              rootContext: string;
              addDependency: (file: string) => void;
            },
            source: string
          ): string {
            const epochPath = join(this.rootContext, 'epoch.txt');
            const epoch = readFileSync(epochPath, 'utf-8').trim();
            this.addDependency(epochPath);
            const file = relative(project.root, this.resourcePath)
              .split(sep)
              .join('/');
            state.log.push({ file, turn: state.turn, epoch });
            return `${source}\n/* epoch:${epoch} via ${file} */\n`;
          }
        );

        const arm = { lateWrite: false };
        const lateEpochWriter = {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          apply(compiler: any) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            compiler.hooks.compilation.tap(
              'control-late',
              (compilation: any) => {
                compilation.hooks.finishModules.tapAsync(
                  'control-late',
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  (_modules: any, callback: () => void) => {
                    if (arm.lateWrite) {
                      arm.lateWrite = false;
                      writeFileSync(join(project.root, 'epoch.txt'), 'E1');
                    }
                    callback();
                  }
                );
              }
            );
          },
        };

        project.backdateAll();
        const records = await runWatchSession({
          webpack,
          root: project.root,
          config: buildConfig({
            root: project.root,
            shimPath,
            plugins: [lateEpochWriter],
          }),
          state,
          steps: [
            () => {
              arm.lateWrite = true;
              project.write('src/a.js', "module.exports = 'a1';\n");
            },
          ],
        });

        const editCompilation = records.find((r) => r.bundle.includes("'a1'"));
        expect(editCompilation).toBeDefined();
        expect(runsFor(editCompilation!, 'src/b.js')).toHaveLength(0);
        expect(editCompilation!.bundle).toMatch(/epoch:E0 via src\/b\.js/);
        const recovery = records.find(
          (r) =>
            r.n > editCompilation!.n && /epoch:E1 via src\/b\.js/.test(r.bundle)
        );
        expect(recovery).toBeDefined();
      });

      test('zero→present: a first chain introduced mid-compilation fails with ANIMUS_ANALYSIS_CATCHING_UP and is never published raw', async () => {
        const webpack = loadFixtureWebpack(fixture.webpackPath);
        const { project, state, plugin, shimPath } = setUpProject([
          PARENT_REL,
          CHILD_REL,
          NEWCOMER_REL,
        ]);
        project.write(NEWCOMER_REL, newcomerRawSource());
        project.write(
          'entry.js',
          entrySource([PARENT_REL, CHILD_REL, NEWCOMER_REL])
        );

        // Registered after the animus plugin: on the armed turn it rewrites
        // the newcomer after analysis commits, so the loader sees new bytes.
        const arm = { midEdit: false };
        const midCompilationEditor = {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          apply(compiler: any) {
            compiler.hooks.watchRun.tapPromise('mid-edit-probe', async () => {
              if (arm.midEdit) {
                arm.midEdit = false;
                project.write(NEWCOMER_REL, newcomerChainSource());
              }
            });
          },
        };

        project.backdateAll();
        const records = await runWatchSession({
          webpack,
          root: project.root,
          config: buildConfig({
            root: project.root,
            shimPath,
            plugins: [plugin, midCompilationEditor],
          }),
          state,
          steps: [
            () => {
              arm.midEdit = true;
              project.write(NEWCOMER_REL, `${newcomerRawSource()}// touch\n`);
            },
          ],
          settleMs: 1500,
        });

        const failing = records.find((r) => r.hasErrors);
        expect(failing).toBeDefined();
        expect(failing!.errors.join('\n')).toContain(
          'ANIMUS_ANALYSIS_CATCHING_UP'
        );

        const final = records[records.length - 1];
        expect(final.hasErrors).toBe(false);
        expect(bundleMarker(final.bundle, NEWCOMER_REL)).toBe('newcomer@G0');
        expect(runsFor(final, NEWCOMER_REL).length).toBeGreaterThan(0);

        for (const record of records) {
          if (record.bundle.includes('// chain')) {
            expect(bundleMarker(record.bundle, NEWCOMER_REL)).not.toBeNull();
          }
        }
      });
    }
  );
}
