import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadSystemModule: vi.fn(),
  analyzeProject: vi.fn<(...args: AnalyzeProjectArgs) => string>(),
  clearAnalysisCache: vi.fn(),
}));

import { setEngineApiOverride } from '../../session/singleton';

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
