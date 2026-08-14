/**
 * Geological-reset failure semantics: a failed system-config reload during a
 * watch cycle is a FAILED CYCLE, not a fallback signal.
 *
 * The regression this pins: the reset re-run was wrapped in a swallow-warn
 * catch, so a broken system edit (syntax error in ds.ts) fell through to the
 * ordinary incremental diff — the watch loop reported success, wrote no
 * `failed` status, and kept analyzing against the pre-edit system config.
 * The contract: the transaction rejects (so a host's per-cycle handler keeps
 * last-good artifacts and reports on stderr), the status artifact lands
 * `failed` with the diagnostic, and no incremental analysis runs against the
 * stale system.
 *
 * Same harness as watch-transaction.test.ts (mocked NAPI boundary, real
 * session, temp project on disk).
 */
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadSystemModule: vi.fn(),
  analyzeProject: vi.fn(),
  clearAnalysisCache: vi.fn(),
}));

import { setEngineApiOverride } from '../../extract/session/singleton';

// Engine API injection through the singleton's globalThis-keyed test
// seam — reaches every copy of the module (source or dist), which a
// module mock cannot.
setEngineApiOverride(() => ({
  loadSystemModule: mocks.loadSystemModule,
  extractFacts: () => '{"files":{},"parseCount":0}',
  analyzeProject: mocks.analyzeProject,
  clearAnalysisCache: mocks.clearAnalysisCache,
}));

import { ExtractionSession } from '../../extract/session/extraction-session';
import { ANALYSIS_STATUS_ARTIFACT } from '../../extract/session/session-paths';
import {
  buildManifest,
  cleanupProjects,
  createProject as createFixtureProject,
  resetAnimusGlobals,
  SYSTEM_CONFIG,
} from './singleton-fixtures';

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
  cleanupProjects();
});

describe('geological-reset failure', () => {
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

    // The system edit that breaks evaluation: the reloader throws the way
    // loadSystemModule does on a syntax error.
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

    // No incremental analysis against the stale system config.
    expect(mocks.analyzeProject.mock.calls.length).toBe(analysesAfterFull);

    // The status artifact carries the terminal failure for loaders.
    const status = JSON.parse(
      readFileSync(join(session.sessionDir, ANALYSIS_STATUS_ARTIFACT), 'utf-8')
    ) as { state: string; diagnostic?: string };
    expect(status.state).toBe('failed');
    expect(status.diagnostic).toContain('unexpected token');

    // Last-good artifacts stay in place for consumers.
    expect(readFileSync(join(session.sessionDir, 'styles.css'), 'utf-8')).toBe(
      cssAfterFull
    );
  });
});
