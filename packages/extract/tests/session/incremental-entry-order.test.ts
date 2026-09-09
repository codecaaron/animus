/**
 * Entry order across the two pipelines.
 *
 * A full pipeline hands the engine its files in `discoverFiles` order; the
 * incremental pass builds its corpus from the session's file cache instead,
 * where a file created mid-watch enters at the end. Both must analyze the
 * same corpus in the same order, or identical inputs stop producing
 * byte-identical artifacts.
 *
 * The nested case matters: `src/b/c.tsx` precedes `src/b.tsx` in the walk
 * (directory `b` sorts before the file `b.tsx` among its siblings), which a
 * flat string sort of the two paths gets backwards.
 *
 * NAPI boundary mocked, session real, temp project on disk. `fileEntries` is
 * slot 0 of the positional `analyzeProject` tuple (analyze-project-args.ts).
 */
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadSystemModule: vi.fn(),
  analyzeProject: vi.fn<(...args: AnalyzeProjectArgs) => string>(),
  clearAnalysisCache: vi.fn(),
}));

import { setEngineApiOverride } from '../../session/singleton';

// Engine API injection through the singleton's globalThis-keyed test seam —
// reaches every copy of the module (source or dist), which a module mock
// cannot.
setEngineApiOverride(() => ({
  extractFacts: () => '{"files":{},"parseCount":0}',
  loadSystemModule: mocks.loadSystemModule,
  analyzeProject: mocks.analyzeProject,
  clearAnalysisCache: mocks.clearAnalysisCache,
}));

import {
  BUTTON_SOURCE,
  buildManifest,
  disposeTempRoots,
  lastAnalyzedPaths as analyzedPaths,
  makeTempRoot,
  resetAnimusGlobals,
  startSession,
  SYSTEM_CONFIG,
} from './session-fixtures';

import type { AnalyzeProjectArgs } from '../../pipeline';

/** Analyzed file paths from the most recent analyzeProject invocation. */
const lastAnalyzedPaths = (): string[] => analyzedPaths(mocks.analyzeProject);

let restoreGlobals: () => void;

beforeEach(() => {
  restoreGlobals = resetAnimusGlobals();
  mocks.loadSystemModule.mockReset().mockReturnValue({ ...SYSTEM_CONFIG });
  mocks.analyzeProject.mockReset().mockImplementation(() => buildManifest({}));
  mocks.clearAnalysisCache.mockReset();
});

afterEach(() => {
  restoreGlobals();
  vi.restoreAllMocks();
  disposeTempRoots();
});

/** Temp project whose walk order is not the flat sort of its paths:
 *  `src/b/c.tsx` → `src/b.tsx` → `src/system.ts`. */
function createNestedProject(): string {
  const root = makeTempRoot('animus-entry-order-');
  mkdirSync(join(root, 'src', 'b'), { recursive: true });
  writeFileSync(
    join(root, 'src', 'system.ts'),
    'export const system = { space: [0, 4, 8] };\n'
  );
  writeFileSync(join(root, 'src', 'b.tsx'), BUTTON_SOURCE);
  writeFileSync(join(root, 'src', 'b', 'c.tsx'), BUTTON_SOURCE);
  return root;
}

describe('incremental analysis entry order', () => {
  test('a full pipeline analyzes in walk order', async () => {
    const root = createNestedProject();
    await startSession(root);

    expect(lastAnalyzedPaths()).toEqual([
      join('src', 'b', 'c.tsx'),
      join('src', 'b.tsx'),
      join('src', 'system.ts'),
    ]);
  });

  test('a file added mid-watch is analyzed in walk position, not last', async () => {
    const root = createNestedProject();
    const session = await startSession(root);

    const added = join(root, 'src', 'Alpha.tsx');
    writeFileSync(added, BUTTON_SOURCE);
    await session.handleWatchUpdate({
      modifiedFiles: new Set([added]),
      removedFiles: new Set(),
    });

    expect(lastAnalyzedPaths()).toEqual([
      join('src', 'Alpha.tsx'),
      join('src', 'b', 'c.tsx'),
      join('src', 'b.tsx'),
      join('src', 'system.ts'),
    ]);
    session.close();
  });
});
