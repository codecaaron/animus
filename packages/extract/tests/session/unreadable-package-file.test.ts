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

const DEV_MODE_SLOT = 7;
const ANALYSIS_CONTEXT_SLOT = 20;

/** The sources the first analysis was told it cannot see. */
function skippedSources(): string[] {
  // SAFETY: the context slot holds the session's own JSON.stringify output,
  // or nothing when the session knows of no unseen source.
  const json = mocks.analyzeProject.mock.calls[0]?.[ANALYSIS_CONTEXT_SLOT] as
    | string
    | undefined;
  if (json === undefined) return [];
  // SAFETY: as above, the context's wire shape.
  const context = JSON.parse(json) as { skippedSources?: string[] };
  return context.skippedSources ?? [];
}

let restoreGlobals: () => void;
let warned: string[];
const lockedFiles: string[] = [];

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

  // The file may render any option, so a production build prunes nothing.
  test('keeps every option and says so, even in production', async () => {
    const { app } = createWorkspace();
    const session = makeSession(app, { mode: 'production' });

    await session.runFullPipeline();

    const line = warned.find((entry) => entry.includes(UNREADABLE_SOURCE_FILE));
    expect(line).toContain('its renders are not seen, so nothing is pruned');
    expect(mocks.analyzeProject.mock.calls[0][DEV_MODE_SLOT]).toBe(false);
    expect(skippedSources()).toEqual([expect.stringContaining('Button.tsx')]);
    session.close();
  });

  test('prunes when every configured file reads', async () => {
    const { app } = createKitWorkspace();
    const session = makeSession(app, { mode: 'production' });

    await session.runFullPipeline();

    expect(mocks.analyzeProject.mock.calls[0][DEV_MODE_SLOT]).toBe(false);
    expect(skippedSources()).toEqual([]);
    session.close();
  });
});

describe('a project file that cannot be read', () => {
  function lockedProject() {
    const { app } = createKitWorkspace();
    const unreadable = join(app, 'src', 'App.tsx');
    chmodSync(unreadable, 0o000);
    lockedFiles.push(unreadable);
    expect(() => readFileSync(unreadable, 'utf-8')).toThrow();
    return app;
  }

  test('fails the build under strict, naming the file and the code', async () => {
    const session = makeSession(lockedProject(), { strict: true });

    await expect(session.runFullPipeline()).rejects.toThrow(
      new RegExp(
        `${UNREADABLE_SOURCE_FILE.replace(/\./g, '\\.')}.*src/App\\.tsx`
      )
    );
    session.close();
  });

  test('warns with what it costs, publishes, and prunes nothing', async () => {
    const session = makeSession(lockedProject(), { mode: 'production' });

    await session.runFullPipeline();

    const line = warned.find((entry) => entry.includes(UNREADABLE_SOURCE_FILE));
    expect(line).toContain('src/App.tsx');
    expect(line).toContain('its renders are not seen, so nothing is pruned');
    expect(mocks.analyzeProject.mock.calls[0][DEV_MODE_SLOT]).toBe(false);
    expect(skippedSources()).toEqual(['src/App.tsx']);
    session.close();
  });
});
