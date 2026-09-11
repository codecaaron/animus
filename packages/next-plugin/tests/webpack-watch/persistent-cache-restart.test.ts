// @vitest-environment node
import { isJsonObject, isJsonString } from '@animus-ui/assertions';
import { existsSync, readFileSync, statSync } from 'fs';
import { join, sep } from 'path';
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
  buildHarnessWebpackConfig,
  bundleMarker,
  CHILD_REL,
  createHarnessProject,
  createWatchState,
  entrySource,
  epochHygieneViolations,
  installLoaderRecorder,
  loadFixtureWebpack,
  LOADER_IMPL_KEY,
  PARENT_REL,
  parentSource,
  resetAnimusGlobals,
  runsFor,
  runWatchSession,
  writeLoaderShim,
} from './watch-session';

import type {
  CompilationRecord,
  HarnessProject,
  WatchState,
} from './watch-session';
import type { JsonValue } from '@animus-ui/assertions';

vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 });

const disposers: Array<() => void> = [];

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  Reflect.deleteProperty(globalThis, LOADER_IMPL_KEY);
  resetAnimusGlobals();
  vi.restoreAllMocks();
});

const FIXTURE = WEBPACK_FIXTURES[0];
const prereq = probeFixtureWebpack(FIXTURE.id);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type FixtureWebpack = ReturnType<typeof loadFixtureWebpack>;

async function runSession(args: {
  webpack: FixtureWebpack;
  project: HarnessProject;
  steps?: Array<(record: CompilationRecord) => void>;
  settleMs?: number;
}): Promise<{ records: CompilationRecord[]; state: WatchState }> {
  const { project } = args;
  resetAnimusGlobals();
  armCannedEngine(mocks);
  const shimPath = writeLoaderShim(project.root);
  const state = createWatchState();
  installLoaderRecorder(project.root, state, animusLoader);
  const plugin = new AnimusWebpackPlugin({
    system: './src/system.ts',
    loaderPath: shimPath,
  });
  const records = await runWatchSession({
    webpack: args.webpack,
    root: project.root,
    config: buildHarnessWebpackConfig({
      root: project.root,
      shimPath,
      plugins: [plugin],
      cache: {
        type: 'filesystem',
        cacheDirectory: join(project.root, '.wpcache'),
      },
    }),
    state,
    steps: args.steps ?? [],
    settleMs: args.settleMs,
  });
  return { records, state };
}

function parseEpoch(raw: string, path: string): string {
  const candidate: JsonValue = JSON.parse(raw);
  if (!isJsonObject(candidate) || !isJsonString(candidate.epoch)) {
    throw new TypeError(`${path} must contain an epoch string`);
  }
  return candidate.epoch;
}

interface EpochArtifact {
  raw: string;
  epoch: string;
  mtimeMs: number;
}

function epochArtifact(path: string): EpochArtifact {
  const raw = readFileSync(path, 'utf-8');
  return {
    raw,
    epoch: parseEpoch(raw, path),
    mtimeMs: statSync(path).mtimeMs,
  };
}

function lastSessionEpochPath(): string {
  const dir = getSessionArtifactDir();
  expect(dir).not.toBeNull();
  return replacementEpochPath(dir!);
}

async function runStabilizedFirstSession(
  webpack: FixtureWebpack,
  project: HarnessProject
): Promise<CompilationRecord[]> {
  const { records } = await runSession({
    webpack,
    project,
    steps: [() => project.write(PARENT_REL, parentSource('G0', 'S1'))],
  });
  expect(records.length).toBeGreaterThanOrEqual(2);
  expect(records[records.length - 1].hasErrors).toBe(false);
  return records;
}

describe.skipIf(!prereq.ok)(`persistent cache restart [${FIXTURE.id}]`, () => {
  test(`prerequisites present${prereq.ok ? '' : ` — SKIPPED: ${prereq.reason}`}`, () => {
    expect(prereq.ok).toBe(true);
  });

  test('step 1: a filesystem-cached animus module snapshot contains the epoch artifact', async () => {
    const webpack = loadFixtureWebpack(FIXTURE.webpackPath);
    const project = createHarnessProject();
    disposers.push(() => project.dispose());
    project.backdateAll();

    const { records } = await runSession({ webpack, project });
    expect(records[0].hasErrors).toBe(false);
    const childDeps = records[0].moduleFileDependencies.get(CHILD_REL);
    expect(childDeps).toBeDefined();
    expect(childDeps).toContain(lastSessionEpochPath());
  });

  test('steps 2+3: warm restart restores without loaders and rewrites nothing; an offline epoch move re-runs loaders with fresh output first', async () => {
    const webpack = loadFixtureWebpack(FIXTURE.webpackPath);
    const project = createHarnessProject();
    disposers.push(() => project.dispose());
    project.backdateAll();

    await runStabilizedFirstSession(webpack, project);
    const session1EpochPath = lastSessionEpochPath();
    const artifactAfterSession1 = epochArtifact(session1EpochPath);

    // The sleep clears the watcher's too-new window before the restart.
    await sleep(1100);
    const warm = await runSession({ webpack, project });
    const warmArtifact = epochArtifact(session1EpochPath);
    expect(warmArtifact.raw).toBe(artifactAfterSession1.raw);
    expect(warmArtifact.mtimeMs).toBe(artifactAfterSession1.mtimeMs);
    expect(epochArtifact(lastSessionEpochPath()).epoch).toBe(
      artifactAfterSession1.epoch
    );
    for (const record of warm.records) {
      expect(runsFor(record, PARENT_REL)).toHaveLength(0);
      expect(runsFor(record, CHILD_REL)).toHaveLength(0);
    }
    const warmFinal = warm.records[warm.records.length - 1];
    expect(warmFinal.hasErrors).toBe(false);
    expect(bundleMarker(warmFinal.bundle, CHILD_REL)).toBe('child@G0');

    project.write(PARENT_REL, parentSource('G1', 'S1'));
    const offline = await runSession({ webpack, project });
    const offlineFinal = offline.records[offline.records.length - 1];
    expect(offlineFinal.hasErrors).toBe(false);
    expect(existsSync(session1EpochPath)).toBe(false);
    const childRuns = offline.records.flatMap((r) => runsFor(r, CHILD_REL));
    expect(childRuns.length).toBeGreaterThan(0);
    const firstWithChild = offline.records.find(
      (r) => bundleMarker(r.bundle, CHILD_REL) !== null
    );
    expect(firstWithChild).toBeDefined();
    expect(bundleMarker(firstWithChild!.bundle, CHILD_REL)).toBe('child@G1');
    expect(epochArtifact(lastSessionEpochPath()).epoch).not.toBe(
      artifactAfterSession1.epoch
    );
  });

  test('step 4: a live shape edit under the filesystem cache fans out in the same compilation with no epoch-triggered compilation (decides DEF-1)', async () => {
    const webpack = loadFixtureWebpack(FIXTURE.webpackPath);
    const project = createHarnessProject();
    disposers.push(() => project.dispose());
    project.backdateAll();

    const { records } = await runSession({
      webpack,
      project,
      steps: [
        () => project.write(PARENT_REL, parentSource('G0', 'S1')),
        () => project.write(PARENT_REL, parentSource('G1', 'S1')),
      ],
    });

    expect(records.length).toBeGreaterThanOrEqual(3);
    expect(records.length).toBeLessThanOrEqual(5);
    const afterAbsorb = records.slice(2);
    const fanOuts = afterAbsorb.filter((r) => runsFor(r, CHILD_REL).length > 0);
    expect(fanOuts).toHaveLength(1);
    const fanOut = fanOuts[0];
    expect(fanOut.hasErrors).toBe(false);
    expect(
      fanOut.modifiedFiles.some((f) => f.endsWith(`${sep}parent.js`))
    ).toBe(true);
    expect(bundleMarker(fanOut.bundle, CHILD_REL)).toBe('child@G1');
    expect(epochHygieneViolations(records, lastSessionEpochPath())).toEqual([]);
  });

  test('step 5 (lazy restore): a module restored on demand rebuilds from the CURRENT epoch, never its stale cached transform', async () => {
    const webpack = loadFixtureWebpack(FIXTURE.webpackPath);
    const project = createHarnessProject();
    disposers.push(() => project.dispose());
    project.backdateAll();

    await runStabilizedFirstSession(webpack, project);

    project.write(PARENT_REL, parentSource('G1', 'S1'));
    project.write('entry.js', entrySource([PARENT_REL]));
    await sleep(1100);

    const session2 = await runSession({
      webpack,
      project,
      steps: [
        () => project.write('entry.js', entrySource([PARENT_REL, CHILD_REL])),
      ],
    });

    const first = session2.records[0];
    expect(runsFor(first, CHILD_REL)).toHaveLength(0);
    expect(bundleMarker(first.bundle, CHILD_REL)).toBeNull();

    const demanded = session2.records.find(
      (r) => bundleMarker(r.bundle, CHILD_REL) !== null
    );
    expect(demanded).toBeDefined();
    expect(runsFor(demanded!, CHILD_REL).length).toBeGreaterThan(0);
    expect(bundleMarker(demanded!.bundle, CHILD_REL)).toBe('child@G1');
  });
});
