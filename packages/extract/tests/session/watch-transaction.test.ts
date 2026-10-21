import { readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { fakeEngineApi } from '../native-functions';

const mocks = vi.hoisted(() => ({
  loadSystemModule: vi.fn(),
  analyzeProject: vi.fn<(...args: AnalyzeProjectArgs) => string>(),
  clearAnalysisCache: vi.fn(),
}));

import { setEngineApiOverride } from '../../session/singleton';

// Injection through the singleton's globalThis seam reaches every copy of
// the module (source or dist); a module mock does not.
setEngineApiOverride(() => ({
  ...fakeEngineApi(),
  extractModuleFacts: () => '{"files":{},"parseCount":0}',
  loadSystemModule: mocks.loadSystemModule,
  analyzeProject: mocks.analyzeProject,
  clearAnalysisCache: mocks.clearAnalysisCache,
}));

import { ExtractionSession } from '../../session/extraction-session';
import {
  findSession,
  getManifestJson,
  getWatchTransaction,
} from '../../session/singleton';
import {
  buildManifest as buildFixtureManifest,
  BUTTON_STYLE_EDIT as BUTTON_SOURCE_CHANGED,
  createProject as createFixtureProject,
  disposeTempRoots,
  lastAnalyzedFiles,
  resetAnimusGlobals,
  SYSTEM_CONFIG,
} from './session-fixtures';

import type { AnalyzeProjectArgs } from '../../pipeline';

let restoreGlobals: () => void;

function buildManifest(css: string): string {
  return buildFixtureManifest({}, css);
}

function createProject(): string {
  return createFixtureProject('animus-txn-');
}

async function startOwner(root: string): Promise<ExtractionSession> {
  mocks.analyzeProject.mockImplementation(() =>
    buildManifest('.btn{margin:8px;}')
  );
  const session = new ExtractionSession({ system: './src/system.ts' });
  session.rootDir = root;
  await session.runFullPipeline();
  return session;
}

/** A batch of an `.mdx` file and a component: the transaction suspends
 *  while it ingests them, so a concurrent entry really races it. */
function makeSuspendingBatch(root: string): Set<string> {
  const mdxPath = join(root, 'src', 'note.mdx');
  writeFileSync(mdxPath, '# note\n');
  const buttonPath = join(root, 'src', 'Button.tsx');
  writeFileSync(buttonPath, BUTTON_SOURCE_CHANGED);
  return new Set([mdxPath, buttonPath]);
}

beforeEach(() => {
  restoreGlobals = resetAnimusGlobals();
  mocks.loadSystemModule.mockReset().mockReturnValue({ ...SYSTEM_CONFIG });
  mocks.analyzeProject.mockReset();
  mocks.clearAnalysisCache.mockReset();
});

afterEach(() => {
  restoreGlobals();
  vi.restoreAllMocks();
  disposeTempRoots();
});

describe('single-flight watch transaction', () => {
  test('a non-owning session entering the same batch awaits the published generation', async () => {
    const root = createProject();
    const owner = await startOwner(root);
    // A participant of the owner's build.
    const follower = new ExtractionSession(
      { system: './src/system.ts' },
      { build: owner.sessionId }
    );
    follower.rootDir = root;

    const batch = makeSuspendingBatch(root);
    const published = buildManifest('.btn{margin:16px;}');
    mocks.analyzeProject.mockImplementation(() => published);

    const ownerEntry = owner.handleWatchUpdate({
      modifiedFiles: batch,
      removedFiles: new Set(),
    });
    const followerEntry = follower.handleWatchUpdate({
      modifiedFiles: batch,
      removedFiles: new Set(),
    });

    // The follower's entry must resolve AFTER the transaction published —
    // never against the pre-transaction generation.
    await followerEntry;
    expect(getManifestJson(owner.key)).toBe(published);

    await ownerEntry;
    expect(getWatchTransaction(owner.key)).toBeNull();
  });

  test('two concurrent entries for one batch run exactly ONE analysis', async () => {
    const root = createProject();
    const owner = await startOwner(root);
    const callsAfterFull = mocks.analyzeProject.mock.calls.length;

    const batch = makeSuspendingBatch(root);
    mocks.analyzeProject.mockImplementation(() =>
      buildManifest('.btn{margin:16px;}')
    );

    const first = owner.handleWatchUpdate({
      modifiedFiles: batch,
      removedFiles: new Set(),
    });
    const second = owner.handleWatchUpdate({
      modifiedFiles: batch,
      removedFiles: new Set(),
    });
    await Promise.all([first, second]);

    expect(mocks.analyzeProject.mock.calls.length).toBe(callsAfterFull + 1);
    expect(getWatchTransaction(owner.key)).toBeNull();
  });

  test('a watch batch entering during an in-flight FULL pipeline joins it', async () => {
    const root = createProject();
    // The full pipeline sets the loaded system before its first await, so a
    // batch arriving in that window takes the owner branch and must join it.
    mocks.analyzeProject.mockImplementation(() =>
      buildManifest('.btn{margin:8px;}')
    );
    const session = new ExtractionSession({ system: './src/system.ts' });
    session.rootDir = root;

    const pipeline = session.runFullPipeline();
    expect(getWatchTransaction(session.key)).not.toBeNull();

    const joiner = session.handleWatchUpdate({
      modifiedFiles: new Set([join(root, 'src', 'Button.tsx')]),
      removedFiles: new Set(),
    });

    await Promise.all([pipeline, joiner]);
    expect(mocks.analyzeProject.mock.calls.length).toBe(1);
    expect(getWatchTransaction(session.key)).toBeNull();
  });

  /** Contract: an observation that arrives during a failing attempt is
   *  never lost. It runs next; the failure is the failing attempt's own. */
  test('an observation that arrives during a failing attempt is never lost', async () => {
    const root = createProject();
    const owner = await startOwner(root);
    // A participant of the owner's build, whose compiler sees another file.
    const follower = new ExtractionSession(
      { system: './src/system.ts' },
      { build: owner.sessionId }
    );
    follower.rootDir = root;

    const failing = makeSuspendingBatch(root);
    const published = buildManifest('.later{margin:4px;}');
    mocks.analyzeProject
      .mockImplementationOnce(() => {
        throw new Error('attempt boom');
      })
      .mockImplementation(() => published);

    const first = owner.handleWatchUpdate({
      modifiedFiles: failing,
      removedFiles: new Set(),
    });
    const laterPath = join(root, 'src', 'Later.tsx');
    const laterSource = 'export const later = 1;\n';
    writeFileSync(laterPath, laterSource);
    const later = follower.handleWatchUpdate({
      modifiedFiles: new Set([laterPath]),
      removedFiles: new Set(),
    });

    await expect(first).rejects.toThrow('attempt boom');
    await later;
    const analyzed = lastAnalyzedFiles(mocks.analyzeProject);
    expect(
      analyzed.find((entry) => entry.path === 'src/Later.tsx')?.source
    ).toBe(laterSource);
    expect(getManifestJson(owner.key)).toBe(published);
    expect(getWatchTransaction(owner.key)).toBeNull();
  });

  /** Contract: an observation that arrives during a failing attempt is
   *  never lost; nor does a stale one outlive a newer observation of its
   *  path. A recreation equal to the active attempt's content supersedes the
   *  deletion queued behind that attempt. */
  test('an equivalent recreation supersedes a queued deletion', async () => {
    const root = createProject();
    const owner = await startOwner(root);
    const batch = makeSuspendingBatch(root);
    const buttonPath = join(root, 'src', 'Button.tsx');
    mocks.analyzeProject.mockImplementation(() =>
      buildManifest('.btn{margin:16px;}')
    );

    // The active attempt takes the button's edit.
    const edit = owner.handleWatchUpdate({
      modifiedFiles: batch,
      removedFiles: new Set(),
    });
    rmSync(buttonPath);
    const deletion = owner.handleWatchUpdate({
      modifiedFiles: new Set(),
      removedFiles: new Set([buttonPath]),
    });
    writeFileSync(buttonPath, BUTTON_SOURCE_CHANGED);
    const recreation = owner.handleWatchUpdate({
      modifiedFiles: new Set([buttonPath]),
      removedFiles: new Set(),
    });
    await Promise.all([edit, deletion, recreation]);

    const analyzed = lastAnalyzedFiles(mocks.analyzeProject);
    expect(analyzed.map((entry) => entry.path)).toContain('src/Button.tsx');
  });

  /** Contract: startup settles the observations queued before it. Its full
   *  read covers them, so none replays over the published corpus later. */
  test('startup settles observations queued before the first analysis', async () => {
    const root = createProject();
    mocks.analyzeProject.mockImplementation(() =>
      buildManifest('.btn{margin:8px;}')
    );
    const session = new ExtractionSession({ system: './src/system.ts' });
    session.rootDir = root;
    const buttonPath = join(root, 'src', 'Button.tsx');
    const source = readFileSync(buttonPath, 'utf-8');

    // No session of the build can analyze yet: the removal stays queued.
    rmSync(buttonPath);
    await session.handleWatchUpdate({
      modifiedFiles: new Set(),
      removedFiles: new Set([buttonPath]),
    });
    writeFileSync(buttonPath, source);
    await session.runFullPipeline();

    // An unrelated edit runs after startup.
    const notePath = join(root, 'src', 'Note.tsx');
    writeFileSync(notePath, 'export const note = 1;\n');
    await session.handleWatchUpdate({
      modifiedFiles: new Set([notePath]),
      removedFiles: new Set(),
    });

    const analyzed = lastAnalyzedFiles(mocks.analyzeProject);
    expect(analyzed.map((entry) => entry.path)).toContain('src/Button.tsx');
  });

  /** Contract: a closed participant never joins again by itself. An
   *  attempt in flight at close finishes under the key it began with. */
  test('a close during an attempt registers no participant after it', async () => {
    const root = createProject();
    const owner = await startOwner(root);
    const follower = new ExtractionSession(
      { system: './src/system.ts' },
      { build: owner.sessionId }
    );
    follower.rootDir = root;
    const key = owner.key;
    expect(follower.key).toEqual(key);
    mocks.analyzeProject.mockImplementation(() =>
      buildManifest('.btn{margin:16px;}')
    );

    // The attempt suspends at its async preprocessing; another edit queues.
    const held = owner.handleWatchUpdate({
      modifiedFiles: makeSuspendingBatch(root),
      removedFiles: new Set(),
    });
    const notePath = join(root, 'src', 'Note.tsx');
    writeFileSync(notePath, 'export const note = 1;\n');
    const queued = follower.handleWatchUpdate({
      modifiedFiles: new Set([notePath]),
      removedFiles: new Set(),
    });
    owner.close();
    follower.close();
    await Promise.allSettled([held, queued]);

    expect(findSession(key)).toBeUndefined();
  });

  test('a failed transaction rejects every joiner and clears the gate', async () => {
    const root = createProject();
    const owner = await startOwner(root);
    // A participant of the owner's build.
    const follower = new ExtractionSession(
      { system: './src/system.ts' },
      { build: owner.sessionId }
    );
    follower.rootDir = root;

    const batch = makeSuspendingBatch(root);
    mocks.analyzeProject.mockImplementation(() => {
      throw new Error('transaction boom');
    });

    const ownerEntry = owner.handleWatchUpdate({
      modifiedFiles: batch,
      removedFiles: new Set(),
    });
    const followerEntry = follower.handleWatchUpdate({
      modifiedFiles: batch,
      removedFiles: new Set(),
    });

    await expect(ownerEntry).rejects.toThrow('transaction boom');
    await expect(followerEntry).rejects.toThrow('transaction boom');
    expect(getWatchTransaction(owner.key)).toBeNull();
  });
});
