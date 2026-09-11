import { readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { contentHash } from '../../pipeline';

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

import { replacementEpochPath } from '../../session/session-paths';
import {
  getAnalyzedHashes,
  getManifestJson,
  getReplacementEpoch,
} from '../../session/singleton';
import {
  buildManifest,
  BUTTON_PLAN_EDIT,
  BUTTON_SOURCE,
  BUTTON_STYLE_EDIT,
  createProject as createFixtureProject,
  disposeTempRoots,
  expectedEpoch,
  PLAN_A,
  PLAN_B,
  resetAnimusGlobals,
  startSession as startFixtureSession,
  SYSTEM_CONFIG,
} from './session-fixtures';

import type { ManifestComponentDescriptor } from '../../pipeline';
import type { ExtractionSession } from '../../session/extraction-session';

let restoreGlobals: () => void;

interface ReplacementEpochRecord {
  schema: number;
  sessionId: string;
  epoch: string;
}

interface EpochArtifactReading {
  raw: string;
  parsed: ReplacementEpochRecord;
  mtimeMs: number;
}

function createProject(): string {
  return createFixtureProject('animus-epoch-');
}

function startSession(
  root: string,
  components: Record<string, ManifestComponentDescriptor>
): Promise<ExtractionSession> {
  mocks.analyzeProject.mockImplementation(() => buildManifest(components));
  return startFixtureSession(root);
}

function epochArtifact(session: ExtractionSession): EpochArtifactReading {
  const path = replacementEpochPath(session.sessionDir);
  const raw = readFileSync(path, 'utf-8');
  return { raw, parsed: JSON.parse(raw), mtimeMs: statSync(path).mtimeMs };
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

describe('epoch artifact publication', () => {
  test('a successful analysis writes {schema, sessionId, epoch} and publishes the epoch', async () => {
    const root = createProject();
    const session = await startSession(root, PLAN_A);

    const { parsed } = epochArtifact(session);
    expect(parsed.schema).toBe(1);
    expect(parsed.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(parsed.sessionId).toBe(session.sessionId);
    expect(parsed.epoch).toBe(expectedEpoch(PLAN_A));
    expect(getReplacementEpoch()).toBe(parsed.epoch);
  });

  test('style-only re-analysis leaves the artifact bytes and mtime untouched', async () => {
    const root = createProject();
    const session = await startSession(root, PLAN_A);
    const before = epochArtifact(session);

    mocks.analyzeProject.mockImplementation(() =>
      buildManifest(PLAN_A, '.btn{margin:16px;}')
    );
    writeFileSync(join(root, 'src', 'Button.tsx'), BUTTON_STYLE_EDIT);
    await session.handleWatchUpdate({
      modifiedFiles: new Set([join(root, 'src', 'Button.tsx')]),
      removedFiles: new Set(),
    });

    expect(mocks.analyzeProject.mock.calls.length).toBe(2);
    const after = epochArtifact(session);
    expect(after.raw).toBe(before.raw);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(getReplacementEpoch()).toBe(before.parsed.epoch);
  });

  test('a plan change rewrites the artifact exactly once with the new epoch', async () => {
    const root = createProject();
    const session = await startSession(root, PLAN_A);
    const before = epochArtifact(session);

    mocks.analyzeProject.mockImplementation(() => buildManifest(PLAN_B));
    writeFileSync(join(root, 'src', 'Button.tsx'), BUTTON_PLAN_EDIT);
    await session.handleWatchUpdate({
      modifiedFiles: new Set([join(root, 'src', 'Button.tsx')]),
      removedFiles: new Set(),
    });

    const after = epochArtifact(session);
    expect(after.parsed.epoch).toBe(expectedEpoch(PLAN_B));
    expect(after.parsed.epoch).not.toBe(before.parsed.epoch);
    expect(after.parsed.sessionId).toBe(before.parsed.sessionId);
    expect(getReplacementEpoch()).toBe(after.parsed.epoch);

    mocks.analyzeProject.mockImplementation(() =>
      buildManifest(PLAN_B, '.btn{margin:24px;}')
    );
    writeFileSync(join(root, 'src', 'Button.tsx'), BUTTON_STYLE_EDIT);
    await session.handleWatchUpdate({
      modifiedFiles: new Set([join(root, 'src', 'Button.tsx')]),
      removedFiles: new Set(),
    });
    const settled = epochArtifact(session);
    expect(settled.raw).toBe(after.raw);
    expect(settled.mtimeMs).toBe(after.mtimeMs);
  });

  test('a deleted epoch artifact is rewritten by the next publish (sibling self-heal)', async () => {
    const root = createProject();
    const session = await startSession(root, PLAN_A);
    const before = epochArtifact(session);

    // Loaders register this path as a dependency and a missing witness is
    // permanently satisfiable, so the next publish must recreate it.
    rmSync(replacementEpochPath(session.sessionDir));

    mocks.analyzeProject.mockImplementation(() =>
      buildManifest(PLAN_A, '.btn{margin:16px;}')
    );
    writeFileSync(join(root, 'src', 'Button.tsx'), BUTTON_STYLE_EDIT);
    await session.handleWatchUpdate({
      modifiedFiles: new Set([join(root, 'src', 'Button.tsx')]),
      removedFiles: new Set(),
    });

    // epochArtifact throws ENOENT while the healing write is missing.
    const healed = epochArtifact(session);
    expect(healed.parsed.epoch).toBe(before.parsed.epoch);
    expect(healed.parsed.sessionId).toBe(session.sessionId);
  });

  test('a fresh same-process session with unchanged plans never rewrites the artifact (warm-restart witness)', async () => {
    const root = createProject();
    const first = await startSession(root, PLAN_A);
    const before = epochArtifact(first);

    // The predecessor closes first: publication ownership is exclusive, and
    // untouched bytes keep persistent-cache snapshots valid.
    first.close();
    const second = await startSession(root, PLAN_A);
    expect(second.sessionId).toBe(first.sessionId);
    const after = epochArtifact(second);
    expect(after.raw).toBe(before.raw);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(getReplacementEpoch()).toBe(before.parsed.epoch);
  });

  test('the analyzed-hash map is published alongside the manifest', async () => {
    const root = createProject();
    await startSession(root, PLAN_A);

    const hashes = getAnalyzedHashes();
    expect(hashes).not.toBeNull();
    expect(hashes!.get('src/Button.tsx')).toBe(contentHash(BUTTON_SOURCE));
    expect(hashes!.get('src/system.ts')).toBe(
      contentHash('export const system = { space: [0, 4, 8] };\n')
    );
  });

  test('no temp-file residue is left next to the artifact', async () => {
    const root = createProject();
    const session = await startSession(root, PLAN_A);
    const { readdirSync } = await import('fs');
    const leftovers = readdirSync(session.sessionDir).filter((name) =>
      name.includes('.tmp')
    );
    expect(leftovers).toEqual([]);
  });
});

describe('failed analyses publish no partial generation', () => {
  test('a failed analysis advances nothing and never suppresses the equal-content retry', async () => {
    const root = createProject();
    const session = await startSession(root, PLAN_A);
    const before = epochArtifact(session);
    const manifestBefore = getManifestJson();

    mocks.analyzeProject.mockImplementationOnce(() => {
      throw new Error('analysis boom');
    });
    writeFileSync(join(root, 'src', 'Button.tsx'), BUTTON_PLAN_EDIT);
    await expect(
      session.handleWatchUpdate({
        modifiedFiles: new Set([join(root, 'src', 'Button.tsx')]),
        removedFiles: new Set(),
      })
    ).rejects.toThrow('analysis boom');

    expect(getManifestJson()).toBe(manifestBefore);
    expect(getReplacementEpoch()).toBe(before.parsed.epoch);
    const afterFailure = epochArtifact(session);
    expect(afterFailure.raw).toBe(before.raw);
    expect(afterFailure.mtimeMs).toBe(before.mtimeMs);

    // The same content observed again must not be suppressed by the cache.
    mocks.analyzeProject.mockImplementation(() => buildManifest(PLAN_B));
    await session.handleWatchUpdate({
      modifiedFiles: new Set([join(root, 'src', 'Button.tsx')]),
      removedFiles: new Set(),
    });
    expect(mocks.analyzeProject.mock.calls.length).toBe(3);
    expect(getReplacementEpoch()).toBe(expectedEpoch(PLAN_B));
    expect(epochArtifact(session).parsed.epoch).toBe(expectedEpoch(PLAN_B));
  });
});
