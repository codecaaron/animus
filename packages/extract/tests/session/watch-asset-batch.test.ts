/**
 * An asset edit and a component edit can arrive in one batch; if the asset
 * path short-circuits the component read, that edit never re-surfaces.
 */
import {
  mkdirSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { join, relative } from 'path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadSystemModule: vi.fn(),
  analyzeProject: vi.fn<(...args: AnalyzeProjectArgs) => string>(),
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
import { SESSION_ASSETS_DIR } from '../../session/session-paths';
import {
  BUTTON_SOURCE,
  BUTTON_STYLE_EDIT as BUTTON_SOURCE_CHANGED,
  disposeTempRoots,
  makeManifest,
  makeTempRoot,
  resetAnimusGlobals,
  SYSTEM_CONFIG,
} from './session-fixtures';

import type { AnalyzeProjectArgs } from '../../pipeline';

function createProject() {
  const root = makeTempRoot('animus-watch-asset-');
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'package.json'), '{"name":"consumer"}');
  writeFileSync(
    join(root, 'src', 'system.ts'),
    'export const system = { space: [0, 4, 8] };\n'
  );
  writeFileSync(join(root, 'src', 'Button.tsx'), BUTTON_SOURCE);
  const assetPath = join(root, 'logo.svg');
  writeFileSync(assetPath, '<svg/>');
  return { root, assetPath };
}

function buildManifest(assetPath: string): string {
  const manifest = makeManifest({ css: '.btn{margin:8;}' });
  manifest.sheets.global = `@layer anm-global{body{background:url('animus-asset:${assetPath}')}}`;
  return JSON.stringify(manifest);
}

function lastAnalyzedEntries(): Array<{ path: string; source: string }> {
  const calls = mocks.analyzeProject.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  const [filesJson] = calls[calls.length - 1];
  expect(filesJson.startsWith('[')).toBe(true);
  return JSON.parse(filesJson);
}

let restoreGlobals: () => void;

beforeEach(() => {
  // The singleton reset gives each test a fresh process image, including the
  // publication claim a session holds until close().
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

async function startSession(root: string, assetPath: string) {
  mocks.analyzeProject.mockImplementation(() => buildManifest(assetPath));
  const session = new ExtractionSession({ system: './src/system.ts' });
  session.rootDir = root;
  await session.runFullPipeline();
  // require.resolve canonicalizes the registered dependency, so this
  // comparison is between realpaths.
  expect(session.assetDependencyPaths.has(realpathSync(assetPath))).toBe(true);
  return session;
}

describe('handleWatchUpdate asset+component batches', () => {
  test('a component edit in the same batch as an asset change is analyzed fresh', async () => {
    const { root, assetPath } = createProject();
    const session = await startSession(root, assetPath);

    const buttonPath = join(root, 'src', 'Button.tsx');
    writeFileSync(buttonPath, BUTTON_SOURCE_CHANGED);
    writeFileSync(assetPath, '<svg><title>touched</title></svg>');

    await session.handleWatchUpdate({
      modifiedFiles: new Set([assetPath, buttonPath]),
      removedFiles: new Set(),
    });

    const button = lastAnalyzedEntries().find(
      (entry) => entry.path === relative(root, buttonPath)
    );
    expect(button).toBeDefined();
    expect(button!.source).toBe(BUTTON_SOURCE_CHANGED);
  });

  test('a removal in the same batch as an asset change is pruned, not replayed', async () => {
    const { root, assetPath } = createProject();
    const session = await startSession(root, assetPath);

    const buttonPath = join(root, 'src', 'Button.tsx');
    rmSync(buttonPath);
    writeFileSync(assetPath, '<svg><title>touched</title></svg>');

    await session.handleWatchUpdate({
      modifiedFiles: new Set([assetPath]),
      removedFiles: new Set([buttonPath]),
    });

    const ghost = lastAnalyzedEntries().find(
      (entry) => entry.path === relative(root, buttonPath)
    );
    expect(ghost).toBeUndefined();
  });

  test('an asset-only batch still re-analyzes (asset substitution refresh)', async () => {
    const { root, assetPath } = createProject();
    const session = await startSession(root, assetPath);
    const callsBefore = mocks.analyzeProject.mock.calls.length;

    writeFileSync(assetPath, '<svg><title>touched</title></svg>');
    await session.handleWatchUpdate({
      modifiedFiles: new Set([assetPath]),
      removedFiles: new Set(),
    });

    expect(mocks.analyzeProject.mock.calls.length).toBe(callsBefore + 1);
  });
});

/**
 * Asset copies are content-addressed and never overwritten, so a revision
 * leaves the previous copy behind until `staleAssetPruning` removes it.
 */
describe('superseded asset copies after an incremental cycle', () => {
  function sessionAssets(session: ExtractionSession): string[] {
    return readdirSync(join(session.sessionDir, SESSION_ASSETS_DIR)).sort();
  }

  async function reviseAsset(
    session: ExtractionSession,
    assetPath: string
  ): Promise<void> {
    writeFileSync(assetPath, '<svg><title>revised</title></svg>');
    await session.handleWatchUpdate({
      modifiedFiles: new Set([assetPath]),
      removedFiles: new Set(),
    });
  }

  test('the default keeps them — a dev server still serves the previous revision', async () => {
    const { root, assetPath } = createProject();
    const session = await startSession(root, assetPath);
    expect(sessionAssets(session)).toHaveLength(1);

    await reviseAsset(session, assetPath);

    expect(sessionAssets(session)).toHaveLength(2);
  });

  test("'every-cycle' deletes them on the incremental cycle itself", async () => {
    const { root, assetPath } = createProject();
    const session = await startSession(root, assetPath);
    session.staleAssetPruning = 'every-cycle';
    const [current] = sessionAssets(session);

    await reviseAsset(session, assetPath);

    const remaining = sessionAssets(session);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).not.toBe(current);
  });
});
