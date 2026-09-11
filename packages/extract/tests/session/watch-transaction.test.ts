import { writeFileSync } from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadSystemModule: vi.fn(),
  analyzeProject: vi.fn(),
  clearAnalysisCache: vi.fn(),
}));

import { setEngineApiOverride } from '../../session/singleton';

// Injection through the singleton's globalThis seam reaches every copy of
// the module (source or dist); a module mock does not.
setEngineApiOverride(() => ({
  extractFacts: () => '{"files":{},"parseCount":0}',
  loadSystemModule: mocks.loadSystemModule,
  analyzeProject: mocks.analyzeProject,
  clearAnalysisCache: mocks.clearAnalysisCache,
}));

import { ExtractionSession } from '../../session/extraction-session';
import { getManifestJson, getWatchTransaction } from '../../session/singleton';
import {
  buildManifest as buildFixtureManifest,
  BUTTON_STYLE_EDIT as BUTTON_SOURCE_CHANGED,
  createProject as createFixtureProject,
  disposeTempRoots,
  resetAnimusGlobals,
  SYSTEM_CONFIG,
} from './session-fixtures';

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

/** A batch whose first entry is an `.mdx` file: the transaction suspends at
 *  the async preprocessing seam, so a concurrent entry really races it. */
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
    const follower = new ExtractionSession({ system: './src/system.ts' });
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
    expect(getManifestJson()).toBe(published);

    await ownerEntry;
    expect(getWatchTransaction()).toBeNull();
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
    expect(getWatchTransaction()).toBeNull();
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
    expect(getWatchTransaction()).not.toBeNull();

    const joiner = session.handleWatchUpdate({
      modifiedFiles: new Set([join(root, 'src', 'Button.tsx')]),
      removedFiles: new Set(),
    });

    await Promise.all([pipeline, joiner]);
    expect(mocks.analyzeProject.mock.calls.length).toBe(1);
    expect(getWatchTransaction()).toBeNull();
  });

  test('a failed transaction rejects every joiner and clears the gate', async () => {
    const root = createProject();
    const owner = await startOwner(root);
    const follower = new ExtractionSession({ system: './src/system.ts' });
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
    expect(getWatchTransaction()).toBeNull();
  });
});
