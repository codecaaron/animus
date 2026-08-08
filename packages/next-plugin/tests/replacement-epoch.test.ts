/**
 * Replacement-epoch publication (openspec:
 * next-webpack-served-transform-coherence, design D3/D5 — increment 01):
 * after every successful analysis the session computes the canonical epoch
 * (`hashReplacementPlans(snapshotFilePlans(manifest), systemPropsContent)` —
 * the served system-props module rides as the served-dependency witness),
 * publishes it via
 * the singleton, and maintains the SESSION-SCOPED disk witness
 * `.animus/sessions/<id>/replacements-epoch` `{schema, sessionId, epoch}` —
 * rewritten ONLY when the epoch value changes (style-only analyses and
 * same-session restarts leave bytes AND mtime untouched). A failed analysis
 * advances nothing and never suppresses an equal-content retry.
 *
 * Same harness as watch-asset-batch.test.ts: the NAPI boundary is mocked,
 * the session and pure pipeline helpers run for real over a temp project.
 */
import {
  buildSystemPropsModule,
  contentHash,
  hashReplacementPlans,
  snapshotFilePlans,
} from '@animus-ui/extract/pipeline';
import { readFileSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadSystemModule: vi.fn(),
  analyzeProject: vi.fn(),
  clearAnalysisCache: vi.fn(),
}));

vi.mock('../src/singleton', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/singleton')>();
  return {
    ...actual,
    engineApi: () => ({
      loadSystemModule: mocks.loadSystemModule,
      analyzeProject: mocks.analyzeProject,
      clearAnalysisCache: mocks.clearAnalysisCache,
    }),
  };
});

import { ExtractionSession } from '../src/extraction-session';
import { replacementEpochPath } from '../src/session-paths';
import {
  getAnalyzedHashes,
  getManifestJson,
  getReplacementEpoch,
} from '../src/singleton';
import {
  buildManifest,
  BUTTON_SHAPE_EDIT,
  BUTTON_SOURCE,
  BUTTON_STYLE_EDIT,
  cleanupProjects,
  createProject as createFixtureProject,
  PLAN_A,
  PLAN_B,
  resetAnimusGlobals,
  SYSTEM_CONFIG,
} from './singleton-fixtures';

let restoreGlobals: () => void;

/** The served system-props module the fixture pipeline emits — the epoch's
 *  served-dependency witness (fixture manifests carry empty prop maps). */
const SYSTEM_PROPS_WITNESS = buildSystemPropsModule({
  systemPropMapJson: '{}',
  groupRegistryJson: SYSTEM_CONFIG.groupRegistry,
  dynamicProps: {},
});

function expectedEpoch(components: Record<string, unknown>): string {
  return hashReplacementPlans(
    snapshotFilePlans({ components }),
    SYSTEM_PROPS_WITNESS
  );
}

function createProject(): string {
  return createFixtureProject('animus-epoch-');
}

async function startSession(
  root: string,
  components: Record<string, unknown>
): Promise<ExtractionSession> {
  mocks.analyzeProject.mockImplementation(() => buildManifest(components));
  const session = new ExtractionSession({ system: './src/system.ts' });
  session.rootDir = root;
  await session.runFullPipeline();
  return session;
}

function epochArtifact(session: ExtractionSession): {
  raw: string;
  parsed: { schema: number; sessionId: string; epoch: string };
  mtimeMs: number;
} {
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
  cleanupProjects();
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

    // Same plans, different CSS — a style-value-only analysis.
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
    writeFileSync(join(root, 'src', 'Button.tsx'), BUTTON_SHAPE_EDIT);
    await session.handleWatchUpdate({
      modifiedFiles: new Set([join(root, 'src', 'Button.tsx')]),
      removedFiles: new Set(),
    });

    const after = epochArtifact(session);
    expect(after.parsed.epoch).toBe(expectedEpoch(PLAN_B));
    expect(after.parsed.epoch).not.toBe(before.parsed.epoch);
    expect(after.parsed.sessionId).toBe(before.parsed.sessionId);
    expect(getReplacementEpoch()).toBe(after.parsed.epoch);

    // A further style-only analysis does not rewrite the new artifact.
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

  test('a fresh same-process session with unchanged plans never rewrites the artifact (warm-restart witness)', async () => {
    const root = createProject();
    const first = await startSession(root, PLAN_A);
    const before = epochArtifact(first);

    // Simulate a same-process config re-evaluation: a NEW session instance
    // adopts the process-claimed identity (same session dir) over identical
    // plans. Bytes and mtime must be untouched so persistent-cache
    // snapshots that include the artifact stay valid.
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
    writeFileSync(join(root, 'src', 'Button.tsx'), BUTTON_SHAPE_EDIT);
    await expect(
      session.handleWatchUpdate({
        modifiedFiles: new Set([join(root, 'src', 'Button.tsx')]),
        removedFiles: new Set(),
      })
    ).rejects.toThrow('analysis boom');

    // Previous generation stays current: manifest, epoch value, artifact.
    expect(getManifestJson()).toBe(manifestBefore);
    expect(getReplacementEpoch()).toBe(before.parsed.epoch);
    const afterFailure = epochArtifact(session);
    expect(afterFailure.raw).toBe(before.raw);
    expect(afterFailure.mtimeMs).toBe(before.mtimeMs);

    // The SAME content observed again re-runs analysis (retry not
    // suppressed by the content-hash cache) and now advances the epoch.
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
