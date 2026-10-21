/**
 * An asset edit and a component edit can arrive in one batch; if the asset
 * path short-circuits the component read, that edit never re-surfaces.
 */
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'fs';
import { join, relative } from 'path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { nativeFunctions } from '../native-functions';

/** An engine's fingerprints, where a row gives the stub them. */
interface Fingerprints {
  fingerprintFile: (path: string) => string | null;
  fingerprintBytes: (bytes: Buffer) => string;
}

const mocks = vi.hoisted(() => {
  const none = (): Fingerprints | null => null;
  return {
    loadSystemModule: vi.fn(),
    analyzeProject: vi.fn<(...args: AnalyzeProjectArgs) => string>(),
    clearAnalysisCache: vi.fn(),
    fingerprints: none(),
  };
});

import { getSharedCss, setEngineApiOverride } from '../../session/singleton';

// Injection through the singleton's globalThis seam reaches every copy of
// the module (source or dist); a module mock does not.
setEngineApiOverride(() => ({
  ...nativeFunctions(),
  extractModuleFacts: () => '{"files":{},"parseCount":0}',
  loadSystemModule: mocks.loadSystemModule,
  analyzeProject: mocks.analyzeProject,
  clearAnalysisCache: mocks.clearAnalysisCache,
  ...mocks.fingerprints,
}));

import { contentHash } from '../../pipeline/content-hash';
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

  /** Contract: asset bytes are identified by hash, never by modification
   *  time and size (SE-5). Bytes that change with both unchanged, and no
   *  event for the asset, still publish a new copy on the next cycle. */
  test('changed asset bytes with the same mtime and size are detected by hash', async () => {
    const { root, assetPath } = createProject();
    // A whole-second mtime, which a restore reproduces exactly.
    const stamp = 1_700_000_000;
    utimesSync(assetPath, stamp, stamp);
    const session = await startSession(root, assetPath);
    const before = getSharedCss(session.key);

    writeFileSync(assetPath, '<svg x=1/>'.slice(0, '<svg/>'.length));
    utimesSync(assetPath, stamp, stamp);
    expect(statSync(assetPath).mtimeMs).toBe(stamp * 1000);
    expect(statSync(assetPath).size).toBe('<svg/>'.length);
    // A cycle the asset itself reported nothing to.
    writeFileSync(join(root, 'src', 'Button.tsx'), BUTTON_SOURCE_CHANGED);
    await session.handleWatchUpdate({
      modifiedFiles: new Set([join(root, 'src', 'Button.tsx')]),
      removedFiles: new Set(),
    });

    const after = getSharedCss(session.key);
    const copy = (css: string) =>
      /assets\/logo\.([0-9a-f]{8})\.svg/.exec(css)?.[1];
    expect(copy(before)).toBeDefined();
    expect(copy(after)).toBeDefined();
    expect(copy(after)).not.toBe(copy(before));
  });

  /** Contract: an asset's copy is paired with the fingerprint of the bytes
   *  it holds. An edit that lands after the copy is made, before the copy's
   *  fingerprint is taken, still publishes a new copy on the next cycle. */
  test('an edit between an asset copy and its fingerprint is detected', async () => {
    const { root, assetPath } = createProject();
    const edited = '<svg><title>edited</title></svg>';
    let edits = 0;
    mocks.fingerprints = {
      // The first file fingerprint lands an edit just before it reads.
      fingerprintFile: (path) => {
        if (edits++ === 0) writeFileSync(assetPath, edited);
        return contentHash(readFileSync(path));
      },
      fingerprintBytes: (bytes) => contentHash(bytes),
    };
    try {
      const session = await startSession(root, assetPath);
      // Any edit in the copy's window, as the first read would see it.
      if (edits === 0) writeFileSync(assetPath, edited);
      writeFileSync(join(root, 'src', 'Button.tsx'), BUTTON_SOURCE_CHANGED);
      await session.handleWatchUpdate({
        modifiedFiles: new Set([join(root, 'src', 'Button.tsx')]),
        removedFiles: new Set(),
      });

      const copy = /assets\/logo\.([0-9a-f]{8})\.svg/.exec(
        getSharedCss(session.key)
      )?.[1];
      expect(copy).toBe(contentHash(edited).slice(0, 8));
    } finally {
      mocks.fingerprints = null;
    }
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
