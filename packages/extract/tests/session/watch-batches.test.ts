import { writeFileSync } from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadSystemModule: vi.fn(),
  analyzeProject: vi.fn(),
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
  buildManifest,
  createProject,
  disposeTempRoots,
  makeSession,
  resetAnimusGlobals,
  SYSTEM_CONFIG,
} from './session-fixtures';

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

describe('a configuration change runs the full pipeline', () => {
  test('a tsconfig edit reloads the system and re-reads its aliases', async () => {
    const root = createProject('animus-config-change-');
    const session = makeSession(root);
    session.development = true;
    session.aliasesFromTsconfig = true;
    await session.runFullPipeline();
    const loads = mocks.loadSystemModule.mock.calls.length;

    const tsconfig = join(root, 'tsconfig.json');
    writeFileSync(
      tsconfig,
      JSON.stringify({ compilerOptions: { paths: { '@ui/*': ['./src/*'] } } })
    );
    await session.handleWatchUpdate({ modifiedFiles: new Set([tsconfig]) });

    expect(mocks.loadSystemModule.mock.calls.length).toBe(loads + 1);
    expect(session.pathAliasesJson).toContain('@ui/');
    session.close();
  });
});
