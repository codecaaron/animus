import {
  chmodSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { fakeEngineApi } from '../native-functions';

const mocks = vi.hoisted(() => ({
  loadSystemModule: vi.fn(),
  analyzeProject: vi.fn(),
  clearAnalysisCache: vi.fn(),
}));

import { setEngineApiOverride } from '../../session/singleton';

setEngineApiOverride(() => ({
  ...fakeEngineApi(),
  extractModuleFacts: () => '{"files":{},"parseCount":0}',
  resolveSpecifier: requireResolveSpecifier,
  loadSystemModule: mocks.loadSystemModule,
  analyzeProject: mocks.analyzeProject,
  clearAnalysisCache: mocks.clearAnalysisCache,
}));

import {
  UNREADABLE_DISCOVERY_PATH,
  UNREADABLE_SOURCE_FILE,
} from '../../pipeline/manifest-diagnostics';
import { getSharedCss } from '../../session/singleton';
import {
  buildManifest,
  createKitWorkspace,
  createProject,
  disposeTempRoots,
  makeSession,
  PLAN_A,
  requireResolveSpecifier,
  resetAnimusGlobals,
  SYSTEM_CONFIG,
} from './session-fixtures';

/** The sources an analysis, the first by default, was told it cannot see. */
function skippedSources(call = 0): string[] {
  const calls = mocks.analyzeProject.mock.calls;
  // SAFETY: the context holds the session's own JSON.stringify output,
  // or nothing when the session knows of no unseen source.
  const json = calls.at(call)?.[0].analysisContextJson;
  if (json === undefined) return [];
  // SAFETY: as above, the context's wire shape.
  const context = JSON.parse(json) as { skippedSources?: string[] };
  return context.skippedSources ?? [];
}

let restoreGlobals: () => void;
let warned: string[];
let reported: string[];
const lockedFiles: string[] = [];
const lockedDirs: string[] = [];

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
  reported = [];
  vi.spyOn(console, 'error').mockImplementation((...parts: unknown[]) => {
    reported.push(parts.map(String).join(' '));
  });
});

afterEach(() => {
  restoreGlobals();
  vi.restoreAllMocks();
  for (const file of lockedFiles.splice(0)) chmodSync(file, 0o644);
  for (const dir of lockedDirs.splice(0)) chmodSync(dir, 0o755);
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
    expect(mocks.analyzeProject.mock.calls[0][0].devMode).toBe(false);
    expect(skippedSources()).toEqual([expect.stringContaining('Button.tsx')]);
    session.close();
  });

  test('prunes when every configured file reads', async () => {
    const { app } = createKitWorkspace();
    const session = makeSession(app, { mode: 'production' });

    await session.runFullPipeline();

    expect(mocks.analyzeProject.mock.calls[0][0].devMode).toBe(false);
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
        `src/App\\.tsx.*\\[${UNREADABLE_SOURCE_FILE.replace(/\./g, '\\.')}\\]`
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
    expect(mocks.analyzeProject.mock.calls[0][0].devMode).toBe(false);
    expect(skippedSources()).toEqual(['src/App.tsx']);
    session.close();
  });
});

// Contract: a directory discovery cannot list is reported with its path and
// cause, not silently dropped, and one inside a path the walk excludes (a
// kit's node_modules) is not reported at all. It is a warning: it fails no
// strict build and holds no pruning off.
describe('a directory discovery cannot read', () => {
  function lockDir(dir: string) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'Hidden.tsx'), 'export const Hidden = 1;\n');
    chmodSync(dir, 0o000);
    lockedDirs.push(dir);
    expect(() => readdirSync(dir)).toThrow();
  }

  test('is reported, in the project and in a kit, and fails nothing', async () => {
    const { app, kit } = createKitWorkspace();
    lockDir(join(app, 'src', 'locked'));
    lockDir(join(kit, 'src', 'locked'));
    lockDir(join(kit, 'src', 'node_modules', 'private'));
    const session = makeSession(app, { mode: 'production', strict: true });

    await session.runFullPipeline();

    const lines = warned.filter((line) =>
      line.includes(UNREADABLE_DISCOVERY_PATH)
    );
    expect(lines).toHaveLength(2);
    expect(lines).toContainEqual(
      expect.stringMatching(/(^|\s)src\/locked\b.*EACCES/)
    );
    expect(lines).toContainEqual(
      expect.stringMatching(/\.\.\/kits\/ui\/src\/locked\b.*EACCES/)
    );
    expect(skippedSources()).toEqual([]);
    session.close();
  });
});

// Decision #56: in development, a changed file that cannot be read is
// reported with its path and cause, and enforced under strict.
describe('a watched change that cannot be read', () => {
  async function lockAfterStartup(strict: boolean) {
    const { app } = createKitWorkspace();
    const session = makeSession(app, { strict });
    session.development = true;
    await session.runFullPipeline();
    const unreadable = join(app, 'src', 'App.tsx');
    chmodSync(unreadable, 0o000);
    lockedFiles.push(unreadable);
    expect(() => readFileSync(unreadable, 'utf-8')).toThrow();
    return { session, unreadable };
  }

  const unreadableLine = (lines: string[]) =>
    lines.find((line) => line.includes(UNREADABLE_SOURCE_FILE));

  test('is reported with its path and cause', async () => {
    const { session, unreadable } = await lockAfterStartup(false);

    await session.handleWatchUpdate({ modifiedFiles: new Set([unreadable]) });

    expect(unreadableLine(warned)).toMatch(/src\/App\.tsx.*EACCES/);
    session.close();
  });

  test('is reported at error level under strict, and the session keeps running', async () => {
    const { session, unreadable } = await lockAfterStartup(true);

    await session.handleWatchUpdate({ modifiedFiles: new Set([unreadable]) });

    expect(unreadableLine(reported)).toMatch(/src\/App\.tsx.*EACCES/);
    session.close();
  });

  test('a deleted file is a removal, not an unreadable change', async () => {
    const { app } = createKitWorkspace();
    const session = makeSession(app, { strict: true });
    session.development = true;
    await session.runFullPipeline();
    const deleted = join(app, 'src', 'App.tsx');
    rmSync(deleted);

    await session.handleWatchUpdate({ modifiedFiles: new Set([deleted]) });

    expect(unreadableLine([...warned, ...reported])).toBeUndefined();
    session.close();
  });

  // The analysis continues on the last good read: no live CSS is lost.
  test('a definition file keeps its CSS while it cannot be read', async () => {
    const app = createProject('animus-unreadable-definition-');
    mocks.analyzeProject.mockImplementation(
      ({ filesJson }: { filesJson: string }) =>
        buildManifest(
          PLAN_A,
          filesJson.includes('src/Button.tsx') ? '.btn{margin:8px}' : ''
        )
    );
    const session = makeSession(app);
    session.development = true;
    await session.runFullPipeline();
    const button = join(app, 'src', 'Button.tsx');
    chmodSync(button, 0o000);
    lockedFiles.push(button);
    expect(() => readFileSync(button, 'utf-8')).toThrow();

    await session.handleWatchUpdate({ modifiedFiles: new Set([button]) });

    expect(unreadableLine(warned)).toMatch(/src\/Button\.tsx.*EACCES/);
    expect(getSharedCss(session.key)).toMatch(/\.btn\s*\{\s*margin:\s*8px/);
    session.close();
  });

  test('a kit file readable again clears its report on a directory event', async () => {
    const { app, kit } = createKitWorkspace();
    const session = makeSession(app);
    session.development = true;
    await session.runFullPipeline();
    const button = join(kit, 'src', 'Button.tsx');
    chmodSync(button, 0o000);
    lockedFiles.push(button);
    expect(() => readFileSync(button, 'utf-8')).toThrow();
    await session.handleWatchUpdate({ modifiedFiles: new Set([button]) });
    expect(skippedSources(-1)).toEqual([expect.stringContaining('Button.tsx')]);

    chmodSync(button, 0o644);
    await session.handleWatchUpdate({
      modifiedFiles: new Set([join(kit, 'src')]),
    });

    expect(skippedSources(-1)).toEqual([]);
    session.close();
  });
});
