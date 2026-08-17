/**
 * Watch batches that touch an asset() dependency (spec:
 * global-styles-system): a branch switch, editor save-all, or git checkout
 * delivers the asset AND component edits in ONE batch, so the asset path
 * must not short-circuit the component read/re-hash/prune flow — a replayed
 * stale cache analyzes old component source and, because the cache was
 * never updated, the edit never re-surfaces on a later cycle.
 *
 * Same harness as plugin-pipeline.test.ts: the NAPI boundary is mocked, the
 * pure pipeline helpers and the session run for real over a temp project.
 */
import { mkdirSync, realpathSync, rmSync, writeFileSync } from 'fs';
import { join, relative } from 'path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadSystemModule: vi.fn(),
  analyzeProject: vi.fn<(...args: AnalyzeProjectArgs) => string>(),
  clearAnalysisCache: vi.fn(),
}));

import { setEngineApiOverride } from '../../extract/session/singleton';

// Engine API injection through the singleton's globalThis-keyed test
// seam — reaches every copy of the module (source or dist), which a
// module mock cannot.
setEngineApiOverride(() => ({
  extractFacts: () => '{"files":{},"parseCount":0}',
  loadSystemModule: mocks.loadSystemModule,
  analyzeProject: mocks.analyzeProject,
  clearAnalysisCache: mocks.clearAnalysisCache,
}));

import { ExtractionSession } from '../../extract/session/extraction-session';
import {
  BUTTON_SOURCE,
  BUTTON_STYLE_EDIT as BUTTON_SOURCE_CHANGED,
  disposeTempRoots,
  makeTempRoot,
  resetAnimusGlobals,
  SYSTEM_CONFIG,
} from './singleton-fixtures';

import type { AnalyzeProjectArgs } from '@animus-ui/extract/pipeline';

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

/** Manifest whose global sheet references the asset by absolute specifier. */
function buildManifest(assetPath: string): string {
  return JSON.stringify({
    css: '.btn{margin:8;}',
    sheets: {
      global: `@layer anm-global{body{background:url('animus-asset:${assetPath}')}}`,
    },
    system_prop_map: {},
    dynamic_props: {},
    diagnostics: [],
  });
}

/** File entries JSON from the most recent analyzeProject invocation — slot 0
 *  of the positional NAPI tuple (analyze-project-args.ts). */
function lastAnalyzedEntries(): Array<{ path: string; source: string }> {
  const calls = mocks.analyzeProject.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  const [filesJson] = calls[calls.length - 1];
  expect(filesJson.startsWith('[')).toBe(true);
  return JSON.parse(filesJson);
}

let restoreGlobals: () => void;

beforeEach(() => {
  // Each test drives its own session over its own root — in production a
  // separate PROCESS. The singleton reset (the sibling suites' convention)
  // gives each one a fresh process image, including the publication claim
  // the session holds until close().
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
  // The asset is a registered watch dependency after the full pipeline
  // (require.resolve canonicalizes, so compare realpaths).
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
