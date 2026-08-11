// @vitest-environment node
/**
 * Differential webpack probes P0/N0/P1/N1 + the zero→present hash-guard
 * end-to-end case (openspec: next-webpack-served-transform-coherence,
 * increment 03 — resolves DEF-2).
 *
 * Runs the REAL AnimusWebpackPlugin and REAL webpack loader (increment 02)
 * against each Next fixture's exact compiled webpack, with the NAPI engine
 * canned at the singleton seam (the same seam every next-plugin unit test
 * uses). The on-disk loader is a delegation shim only because webpack
 * `require`s loaders from disk and cannot load TypeScript — the executed
 * loader body is `src/loader.ts`.
 *
 * Correctness vs hygiene split (consult §W): correctness = the first
 * successful publication after an epoch move carries every fresh
 * descendant transform; hygiene = no compilation is triggered by the
 * integration's own epoch write.
 */
import { writeFileSync } from 'fs';
import { join, relative, sep } from 'path';
import { afterEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadSystemModule: vi.fn(),
  analyzeProject: vi.fn(),
  clearAnalysisCache: vi.fn(),
  transformFile: vi.fn(),
}));

import { setEngineApiOverride } from '../../../extract/session/singleton';

// Engine API injection through the singleton's globalThis-keyed test
// seam — reaches every copy of the module (source or dist, and the
// loader's CJS require inside webpack), which a module mock cannot.
setEngineApiOverride(() => ({
  loadSystemModule: mocks.loadSystemModule,
  analyzeProject: mocks.analyzeProject,
  clearAnalysisCache: mocks.clearAnalysisCache,
  transformFile: mocks.transformFile,
}));

import { replacementEpochPath } from '../../../extract/session/session-paths';
import { getSessionArtifactDir } from '../../../extract/session/singleton';
import animusLoader from '../../src/loader';
import { AnimusWebpackPlugin } from '../../src/plugin';
import {
  armCannedEngine,
  buildGauntletConfig as buildConfig,
  bundleMarker,
  CHILD_REL,
  createGauntletProject,
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
  writeLoaderShim,
} from './harness';
import { probeFixtureWebpack, WEBPACK_FIXTURES } from './prerequisites';

import type { GauntletProject, WatchState } from './harness';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const g = globalThis as Record<string, unknown>;
const disposers: Array<() => void> = [];

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  delete g[LOADER_IMPL_KEY];
  resetAnimusGlobals();
  vi.restoreAllMocks();
});

function setUpProject(entryModules?: string[]): {
  project: GauntletProject;
  state: WatchState;
  plugin: AnimusWebpackPlugin;
  shimPath: string;
} {
  resetAnimusGlobals();
  armCannedEngine(mocks);
  const project = createGauntletProject({ entryModules });
  disposers.push(() => project.dispose());
  const shimPath = writeLoaderShim(project.root);
  const state = createWatchState();
  disposers.push(
    installLoaderRecorder(
      project.root,
      state,
      animusLoader as unknown as (this: unknown, source: string) => string
    )
  );
  const plugin = new AnimusWebpackPlugin({
    system: './src/system.ts',
    loaderPath: shimPath,
  });
  return { project, state, plugin, shimPath };
}

for (const fixture of WEBPACK_FIXTURES) {
  const prereq = probeFixtureWebpack(fixture.id);

  describe.skipIf(!prereq.ok)(`differential probes [${fixture.id}]`, () => {
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

      // Assert over the turn evidence so a spurious extra compilation names
      // its trigger set and errors in the failure output.
      const turnEvidence = records.map((r) => ({
        n: r.n,
        turn: r.turn,
        modifiedFiles: r.modifiedFiles,
        errors: r.errors,
      }));
      expect(turnEvidence).toHaveLength(1);
      expect(records[0].errors).toEqual([]);
      expect(records[0].hasErrors).toBe(false);
      // The dependency is the SESSION-scoped epoch artifact of the session
      // that ran this watch (still published on the singleton here).
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

      // KNOWN ONE-TIME COLD COST (probe-verified, this suite's harness):
      // the compilation whose watchRun CREATES the epoch artifact snapshots
      // it "too new" (webpack fileSystemInfo safe-time), so the FIRST edit
      // after the artifact's first-ever creation rebuilds every animus
      // module once and re-snapshots them safely. c2 absorbs that; the
      // steady-state claim — the spec scenario — is measured at c3.
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

      // Cold, absorb, measure (+ at most OS redelivery of a source edit).
      expect(records.length).toBeGreaterThanOrEqual(3);
      expect(records.length).toBeLessThanOrEqual(5);
      // The measured claim: after the absorb compilation, style-only edits
      // re-ran the parent but NEVER the sibling, and no compilation was
      // triggered by the integration's own writes.
      const measured = records.slice(2);
      expect(measured.some((r) => runsFor(r, PARENT_REL).length > 0)).toBe(
        true
      );
      for (const record of measured) {
        // The error STRINGS first — a failure names what broke (e.g. a
        // catching-up loader) instead of a bare boolean.
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

      // c2 (style edit) absorbs the one-time cold-artifact snapshot cost
      // and re-snapshots every animus module safely; the ignored epoch is
      // never re-stat'd live (probe-verified), so a c3 descendant rebuild
      // can come from ONE mechanism only: the needBuild fan-out.
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

      // Correctness: the shape edit's triggering compilation ITSELF re-ran
      // the descendant's loader exactly once and published both fresh
      // transforms — same-compilation delivery, no later catch-up.
      expect(records.length).toBeGreaterThanOrEqual(3);
      expect(records.length).toBeLessThanOrEqual(5);
      const afterAbsorb = records.slice(2);
      const fanOuts = afterAbsorb.filter(
        (r) => runsFor(r, CHILD_REL).length > 0
      );
      expect(fanOuts).toHaveLength(1);
      const fanOut = fanOuts[0];
      expect(fanOut.hasErrors).toBe(false);
      expect(runsFor(fanOut, CHILD_REL)).toHaveLength(1);
      // The trigger was the parent SOURCE edit — the fan-out rode the
      // triggering compilation, not a follow-up.
      expect(
        fanOut.modifiedFiles.some((f) => f.endsWith(`${sep}parent.js`))
      ).toBe(true);
      expect(bundleMarker(fanOut.bundle, PARENT_REL)).toBe('parent@G1');
      expect(bundleMarker(fanOut.bundle, CHILD_REL)).toBe('child@G1');
      // Hygiene: no compilation was ever triggered by the epoch artifact —
      // neither its first write nor its rewrite (watch-ignored).
      expect(
        epochHygieneViolations(
          records,
          replacementEpochPath(getSessionArtifactDir()!)
        )
      ).toEqual([]);
    });

    test('N1 (CONTROL): a deliberately-late epoch write without needBuild publishes stale same-compilation output', async () => {
      // Probe-discrimination control (consult §W; probe variants A/B): NO
      // animus plugin, plain addDependency on a watched epoch file written
      // late (finishModules). The control PASSES iff the triggering
      // compilation publishes the sibling STALE and only an echo
      // compilation recovers — proving this suite can tell lagged delivery
      // from same-compilation delivery.
      const webpack = loadFixtureWebpack(fixture.webpackPath);
      resetAnimusGlobals();
      const project = createGauntletProject({
        entryModules: ['src/a.js', 'src/b.js'],
      });
      disposers.push(() => project.dispose());
      project.write('src/a.js', "module.exports = 'a0';\n");
      project.write('src/b.js', "module.exports = 'b0';\n");
      project.write('epoch.txt', 'E0');
      const shimPath = writeLoaderShim(project.root);
      const state = createWatchState();
      g[LOADER_IMPL_KEY] = function (
        this: {
          resourcePath: string;
          rootContext: string;
          addDependency: (file: string) => void;
        },
        source: string
      ): string {
        const epochPath = join(this.rootContext, 'epoch.txt');
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const epoch = (require('fs') as typeof import('fs'))
          .readFileSync(epochPath, 'utf-8')
          .trim();
        this.addDependency(epochPath);
        const file = relative(project.root, this.resourcePath)
          .split(sep)
          .join('/');
        state.log.push({ file, turn: state.turn, epoch });
        return `${source}\n/* epoch:${epoch} via ${file} */\n`;
      };

      const arm = { lateWrite: false };
      const lateEpochWriter = {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        apply(compiler: any) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          compiler.hooks.compilation.tap('control-late', (compilation: any) => {
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

      // The compilation that carried the a-edit publishes b STALE at E0 —
      // the mixed-generation shape the live mechanism exists to kill.
      const editCompilation = records.find((r) => r.bundle.includes("'a1'"));
      expect(editCompilation).toBeDefined();
      expect(runsFor(editCompilation!, 'src/b.js')).toHaveLength(0);
      expect(editCompilation!.bundle).toMatch(/epoch:E0 via src\/b\.js/);
      // Recovery arrives only via a LATER (echo) compilation.
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

      // Post-transaction editor: registered AFTER the animus plugin, so on
      // the armed turn it rewrites the newcomer AFTER analysis committed —
      // the loader then observes content the committed analysis never saw.
      const arm = { midEdit: false };
      const midCompilationEditor = {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        apply(compiler: any) {
          compiler.hooks.watchRun.tapPromise('gauntlet-mid-edit', async () => {
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
            // The observable trigger: a benign newcomer touch — still zero
            // entries when analyzed; the mid-compilation edit then lands
            // the FIRST chain before the loader runs.
            project.write(NEWCOMER_REL, `${newcomerRawSource()}// touch\n`);
          },
        ],
        settleMs: 1500,
      });

      // The compilation that observed the mismatch failed with the stable
      // diagnostic instead of publishing unanalyzed raw bytes.
      const failing = records.find((r) => r.hasErrors);
      expect(failing).toBeDefined();
      expect(failing!.errors.join('\n')).toContain(
        'ANIMUS_ANALYSIS_CATCHING_UP'
      );

      // The next watch turn analyzed the new content and transformed it.
      const final = records[records.length - 1];
      expect(final.hasErrors).toBe(false);
      expect(bundleMarker(final.bundle, NEWCOMER_REL)).toBe('newcomer@G0');
      expect(runsFor(final, NEWCOMER_REL).length).toBeGreaterThan(0);

      // No publication ever exposed the raw chain bytes untransformed.
      for (const record of records) {
        if (record.bundle.includes('// chain')) {
          expect(bundleMarker(record.bundle, NEWCOMER_REL)).not.toBeNull();
        }
      }
    });
  });
}
