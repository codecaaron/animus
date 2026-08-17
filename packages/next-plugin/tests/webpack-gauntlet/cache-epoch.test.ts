// @vitest-environment node
/**
 * W-CACHE-EPOCH — persistent filesystem-cache restart fixtures (openspec:
 * next-webpack-served-transform-coherence, increment 03 — resolves DEF-1).
 *
 * Five steps (consult §W): (1) snapshot-contains-epoch, (2) warm negative —
 * a restart with unchanged plans rewrites nothing and restores modules
 * WITHOUT their loaders running, (3) offline positive — an epoch move while
 * the server was down invalidates restored modules and the first output is
 * fresh, (4) hot hygiene — live needBuild fan-out under a filesystem cache
 * with no epoch-triggered compilation, (5) lazy restore — a module restored
 * on demand rebuilds from the CURRENT epoch.
 *
 * A dev-server "restart" is modeled as: close the watcher AND compiler
 * (flushing the pack), clear every animus globalThis key, and start a new
 * plugin/session over the same project root and cache directory.
 */
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

// Engine API injection through the singleton's globalThis-keyed test
// seam — reaches every copy of the module (source or dist, and the
// loader's CJS require inside webpack), which a module mock cannot.
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
import {
  armCannedEngine,
  buildGauntletConfig,
  bundleMarker,
  CHILD_REL,
  createGauntletProject,
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
} from './harness';
import { probeFixtureWebpack, WEBPACK_FIXTURES } from './prerequisites';

import type { CompilationRecord, GauntletProject, WatchState } from './harness';
import type { JsonValue } from '@animus-ui/assertions';

vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 });

const disposers: Array<() => void> = [];

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  Reflect.deleteProperty(globalThis, LOADER_IMPL_KEY);
  resetAnimusGlobals();
  vi.restoreAllMocks();
});

const FIXTURE = WEBPACK_FIXTURES[0]; // next-app — the primary fixture
const prereq = probeFixtureWebpack(FIXTURE.id);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The fixture's compiled webpack factory, as the harness loads it. */
type FixtureWebpack = ReturnType<typeof loadFixtureWebpack>;

/** One dev-server session over the shared project + cache dir. */
async function runSession(args: {
  webpack: FixtureWebpack;
  project: GauntletProject;
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
    config: buildGauntletConfig({
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

// ── Epoch artifact boundary ───────────────────────────────────────────────
// The artifact is read back from disk as JSON text (a restart may have been
// written by a different session), so its epoch is decoded, not asserted.

function parseEpoch(raw: string, path: string): string {
  const candidate: JsonValue = JSON.parse(raw);
  if (!isJsonObject(candidate) || !isJsonString(candidate.epoch)) {
    throw new TypeError(`${path} must contain an epoch string`);
  }
  return candidate.epoch;
}

/** On-disk state of one replacement-epoch artifact. */
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

/** Session-scoped epoch path of the session that just ran (still on the
 *  singleton until the next runSession resets the globals). */
function lastSessionEpochPath(): string {
  const dir = getSessionArtifactDir();
  expect(dir).not.toBeNull();
  return replacementEpochPath(dir!);
}

/**
 * Session 1 for every restart fixture: cold build + one style-only edit.
 * The second compilation absorbs the one-time too-new snapshot created by
 * the artifact's first write (see the differential N0 note) so the pack
 * persists SAFE snapshots — exactly the state a real project is in after
 * any prior dev session.
 */
async function runStabilizedFirstSession(
  webpack: FixtureWebpack,
  project: GauntletProject
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

describe.skipIf(!prereq.ok)(`W-CACHE-EPOCH [${FIXTURE.id}]`, () => {
  test(`prerequisites present${prereq.ok ? '' : ` — SKIPPED: ${prereq.reason}`}`, () => {
    expect(prereq.ok).toBe(true);
  });

  test('step 1: a filesystem-cached animus module snapshot contains the epoch artifact', async () => {
    const webpack = loadFixtureWebpack(FIXTURE.webpackPath);
    const project = createGauntletProject();
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
    const project = createGauntletProject();
    disposers.push(() => project.dispose());
    project.backdateAll();

    // Session 1 (stabilized) — plans at G0.
    await runStabilizedFirstSession(webpack, project);
    const session1EpochPath = lastSessionEpochPath();
    const artifactAfterSession1 = epochArtifact(session1EpochPath);

    // ── Step 2: WARM NEGATIVE ─────────────────────────────────────────
    // Nothing changed while down. Leave the watcher's too-new window.
    await sleep(1100);
    const warm = await runSession({ webpack, project });
    // Session 1's artifact — the one restored-module snapshots reference —
    // is byte-untouched: the new session's epoch AGREES, so sibling
    // reconciliation leaves it alone and the snapshots stay valid.
    const warmArtifact = epochArtifact(session1EpochPath);
    expect(warmArtifact.raw).toBe(artifactAfterSession1.raw);
    expect(warmArtifact.mtimeMs).toBe(artifactAfterSession1.mtimeMs);
    // The warm session's own artifact carries the same epoch value.
    expect(epochArtifact(lastSessionEpochPath()).epoch).toBe(
      artifactAfterSession1.epoch
    );
    // Restored WITHOUT loaders: no animus loader invocation in any
    // compilation of the warm session, output still the G0 transforms.
    for (const record of warm.records) {
      expect(runsFor(record, PARENT_REL)).toHaveLength(0);
      expect(runsFor(record, CHILD_REL)).toHaveLength(0);
    }
    const warmFinal = warm.records[warm.records.length - 1];
    expect(warmFinal.hasErrors).toBe(false);
    expect(bundleMarker(warmFinal.bundle, CHILD_REL)).toBe('child@G0');

    // ── Step 3: OFFLINE POSITIVE ──────────────────────────────────────
    // A parent shape edit lands while the server is down: the descendant's
    // plan moves G0→G1 offline.
    project.write(PARENT_REL, parentSource('G1', 'S1'));
    const offline = await runSession({ webpack, project });
    const offlineFinal = offline.records[offline.records.length - 1];
    expect(offlineFinal.hasErrors).toBe(false);
    // The restored descendant was invalidated because the new session's
    // first publication moved the epoch and reconciled the DISAGREEING
    // session-1 artifact away — the snapshot referencing it can no longer
    // validate, so the loader RAN and the FIRST successful output is fresh.
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

  test('step 4 (hot hygiene — DEF-1 decider): live shape edit fans out same-compilation under the filesystem cache with no epoch-triggered compilation', async () => {
    const webpack = loadFixtureWebpack(FIXTURE.webpackPath);
    const project = createGauntletProject();
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

    // Correctness: after the absorb compilation the descendant's loader ran
    // in EXACTLY ONE compilation — the one the parent source edit itself
    // triggered — and that compilation published the fresh transform.
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
    // Hygiene: neither the artifact's rewrite nor any other `.animus` write
    // triggered a compilation under the filesystem cache.
    expect(epochHygieneViolations(records, lastSessionEpochPath())).toEqual([]);
  });

  test('step 5 (lazy restore): a module restored on demand rebuilds from the CURRENT epoch, never its stale cached transform', async () => {
    const webpack = loadFixtureWebpack(FIXTURE.webpackPath);
    const project = createGauntletProject();
    disposers.push(() => project.dispose());
    project.backdateAll();

    // Session 1 (stabilized): parent + child built and cached at G0.
    await runStabilizedFirstSession(webpack, project);

    // Offline: the epoch moves (parent shape edit) AND the entry drops the
    // child, so the child is NOT part of the next session's first graph.
    project.write(PARENT_REL, parentSource('G1', 'S1'));
    project.write('entry.js', entrySource([PARENT_REL]));
    await sleep(1100);

    const session2 = await runSession({
      webpack,
      project,
      steps: [
        // Re-demand the child: its only candidate is the G0 cache entry.
        () => project.write('entry.js', entrySource([PARENT_REL, CHILD_REL])),
      ],
    });

    // First compilation: child absent from the graph entirely.
    const first = session2.records[0];
    expect(runsFor(first, CHILD_REL)).toHaveLength(0);
    expect(bundleMarker(first.bundle, CHILD_REL)).toBeNull();

    // The compilation that re-demanded it must NOT restore the stale G0
    // transform: the loader runs and the served transform derives from the
    // CURRENT generation.
    const demanded = session2.records.find(
      (r) => bundleMarker(r.bundle, CHILD_REL) !== null
    );
    expect(demanded).toBeDefined();
    expect(runsFor(demanded!, CHILD_REL).length).toBeGreaterThan(0);
    expect(bundleMarker(demanded!.bundle, CHILD_REL)).toBe('child@G1');
  });
});
