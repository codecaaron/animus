import { readFileSync, writeFileSync } from 'fs';
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
  loadSystemModule: mocks.loadSystemModule,
  extractFacts: () => '{"files":{},"parseCount":0}',
  analyzeProject: mocks.analyzeProject,
  clearAnalysisCache: mocks.clearAnalysisCache,
}));

import { ExtractionSession } from '../../session/extraction-session';
import { ANALYSIS_STATUS_ARTIFACT } from '../../session/session-paths';
import { getManifestJson } from '../../session/singleton';
import {
  buildManifest,
  createProject as createFixtureProject,
  disposeTempRoots,
  resetAnimusGlobals,
  SYSTEM_CONFIG,
} from './session-fixtures';

import type { AnalysisStatus } from '../../session/session-paths';

let restoreGlobals: () => void;

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

describe('system reload failure', () => {
  test('a failed system reload rejects the cycle, lands failed status, and never falls through to incremental', async () => {
    const root = createFixtureProject('animus-geo-fail-');
    mocks.analyzeProject.mockImplementation(() => buildManifest({}));
    const session = new ExtractionSession({ system: './src/system.ts' });
    session.rootDir = root;
    await session.runFullPipeline();
    const analysesAfterFull = mocks.analyzeProject.mock.calls.length;
    const cssAfterFull = readFileSync(
      join(session.sessionDir, 'styles.css'),
      'utf-8'
    );

    const systemPath = join(root, 'src', 'system.ts');
    writeFileSync(systemPath, 'export const system = {;\n');
    mocks.loadSystemModule.mockImplementation(() => {
      throw new Error('SyntaxError: unexpected token in system.ts');
    });

    await expect(
      session.handleWatchUpdate({
        modifiedFiles: new Set([systemPath]),
        removedFiles: new Set(),
      })
    ).rejects.toThrow(/unexpected token/);

    expect(mocks.analyzeProject.mock.calls.length).toBe(analysesAfterFull);

    const status: AnalysisStatus = JSON.parse(
      readFileSync(join(session.sessionDir, ANALYSIS_STATUS_ARTIFACT), 'utf-8')
    );
    expect(status.state).toBe('failed');
    expect(status.diagnostic).toContain('unexpected token');

    expect(readFileSync(join(session.sessionDir, 'styles.css'), 'utf-8')).toBe(
      cssAfterFull
    );
  });
});

describe('failed full pipeline', () => {
  test('a session whose first pipeline failed never answers as the watch owner', async () => {
    const root = createFixtureProject('animus-owner-fail-');
    const session = new ExtractionSession({ system: './src/system.ts' });
    session.rootDir = root;

    // The system loads and the analysis then fails, so the pass registers no
    // owner and fills no caches.
    mocks.analyzeProject.mockImplementation(() => {
      throw new Error('analysis boom');
    });
    await expect(session.runFullPipeline()).rejects.toThrow('analysis boom');

    // Ownership is decided by the loaded-system field: leaving it set after a
    // failed pass publishes a generation built from caches never filled.
    mocks.analyzeProject.mockImplementation(() => buildManifest({}));
    const analysesAfterFailure = mocks.analyzeProject.mock.calls.length;
    await session.handleWatchUpdate({
      modifiedFiles: new Set([join(root, 'src', 'Button.tsx')]),
      removedFiles: new Set(),
    });

    expect(mocks.analyzeProject.mock.calls.length).toBe(analysesAfterFailure);
    // The singleton spells "unset" as either absent or null.
    expect(getManifestJson() ?? null).toBeNull();
  });
});
