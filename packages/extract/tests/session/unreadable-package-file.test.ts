/**
 * A configured external package file that cannot be read: the collector
 * skips it and the analysis runs over a corpus missing a file the project's
 * own `includes` graph named. That is lost input, not degraded output, so it
 * carries `severity: 'error'` and fails `--strict` through the one
 * escalation point in manifest-diagnostics, as an unresolvable include does.
 * Without strict it warns and the build proceeds.
 *
 * NAPI boundary mocked; discovery, collection, and the session pipeline run
 * for real over a temp workspace shaped like a monorepo.
 */
import { chmodSync, readFileSync } from 'fs';
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

import { UNREADABLE_SOURCE_FILE } from '../../pipeline/manifest-diagnostics';
import {
  buildManifest,
  createKitWorkspace,
  disposeTempRoots,
  makeSession,
  PLAN_A,
  resetAnimusGlobals,
  SYSTEM_CONFIG,
} from './session-fixtures';

let restoreGlobals: () => void;
let warned: string[];
/** Restored before disposal so the temp tree is removable everywhere. */
const lockedFiles: string[] = [];

/** The shared kit workspace with one of the kit's source files made
 *  unreadable — the configured input this suite is about. */
function createWorkspace() {
  const { app, kit } = createKitWorkspace();
  const unreadable = join(kit, 'src', 'Button.tsx');
  chmodSync(unreadable, 0o000);
  lockedFiles.push(unreadable);
  // The read must actually fail for this fixture, or every expectation below
  // passes vacuously (a root user, for one, can read a 0o000 file).
  expect(() => readFileSync(unreadable, 'utf-8')).toThrow();
  return { app, unreadable };
}

beforeEach(() => {
  restoreGlobals = resetAnimusGlobals();
  mocks.loadSystemModule.mockReset().mockReturnValue({ ...SYSTEM_CONFIG });
  mocks.analyzeProject
    .mockReset()
    .mockImplementation(() => buildManifest(PLAN_A));
  mocks.clearAnalysisCache.mockReset();
  warned = [];
  vi.spyOn(console, 'warn').mockImplementation((...parts: unknown[]) => {
    warned.push(parts.map(String).join(' '));
  });
});

afterEach(() => {
  restoreGlobals();
  vi.restoreAllMocks();
  for (const file of lockedFiles.splice(0)) chmodSync(file, 0o644);
  disposeTempRoots();
});

describe('a configured package file that cannot be read', () => {
  test('fails the build under strict, naming the file and the code', async () => {
    const { app } = createWorkspace();
    const session = makeSession(app, { strict: true });

    await expect(session.runFullPipeline()).rejects.toThrow(
      new RegExp(UNREADABLE_SOURCE_FILE.replace(/\./g, '\\.'))
    );
    await expect(session.runFullPipeline()).rejects.toThrow(/Button\.tsx/);
    session.close();
  });

  test('warns and publishes without strict', async () => {
    const { app } = createWorkspace();
    const session = makeSession(app);

    await session.runFullPipeline();

    const lines = warned.filter((line) =>
      line.includes(UNREADABLE_SOURCE_FILE)
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('Button.tsx');
    expect(mocks.analyzeProject.mock.calls.length).toBe(1);
    session.close();
  });
});
