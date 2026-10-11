import { readFileSync, realpathSync, writeFileSync } from 'fs';
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
  makeManifest,
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
    expect(getManifestJson(session.key) ?? null).toBeNull();
  });
});

// Row 8b: in development, the last-good generation is held, along with the
// reload debt.
describe('reload debt', () => {
  async function developmentSession(root: string) {
    const session = new ExtractionSession({ system: './src/system.ts' });
    session.rootDir = root;
    session.development = true;
    await session.runFullPipeline();
    return session;
  }

  const readStatus = (session: ExtractionSession): AnalysisStatus =>
    JSON.parse(
      readFileSync(join(session.sessionDir, ANALYSIS_STATUS_ARTIFACT), 'utf-8')
    );

  test('a failed dev system reload is retried until it succeeds, and nothing publishes against the stale system', async () => {
    const root = createFixtureProject('animus-reload-debt-');
    mocks.analyzeProject.mockImplementation(() => buildManifest({}));
    const session = await developmentSession(root);
    const systemPath = join(root, 'src', 'system.ts');
    const buttonPath = join(root, 'src', 'Button.tsx');
    mocks.loadSystemModule.mockImplementation(() => {
      throw new Error('SyntaxError: unexpected token in system.ts');
    });
    await expect(
      session.handleWatchUpdate({ modifiedFiles: new Set([systemPath]) })
    ).rejects.toThrow(/unexpected token/);
    const analysesWhileOwed = mocks.analyzeProject.mock.calls.length;

    writeFileSync(buttonPath, '// a component edit during the debt\n');
    await expect(
      session.handleWatchUpdate({ modifiedFiles: new Set([buttonPath]) })
    ).rejects.toThrow(/unexpected token/);

    expect(mocks.analyzeProject.mock.calls.length).toBe(analysesWhileOwed);
    expect(readStatus(session).state).toBe('failed');

    // The fix reaches the session through any batch, a component one here.
    mocks.loadSystemModule.mockReturnValue({ ...SYSTEM_CONFIG });
    writeFileSync(buttonPath, '// another component edit\n');
    await session.handleWatchUpdate({ modifiedFiles: new Set([buttonPath]) });

    expect(mocks.analyzeProject.mock.calls.length).toBe(analysesWhileOwed + 1);
    expect(readStatus(session).state).not.toBe('failed');
    session.close();
  });

  test('a failed rescan owes the reload, so the next edit does not publish against the stale system', async () => {
    const root = createFixtureProject('animus-rescan-debt-');
    mocks.analyzeProject.mockImplementation(() => buildManifest({}));
    const session = await developmentSession(root);
    const buttonPath = join(root, 'src', 'Button.tsx');
    mocks.loadSystemModule.mockImplementation(() => {
      throw new Error('SyntaxError: unexpected token in system.ts');
    });
    await expect(session.catchUp()).rejects.toThrow(/unexpected token/);
    const analysesWhileOwed = mocks.analyzeProject.mock.calls.length;

    writeFileSync(buttonPath, '// a component edit after the failed rescan\n');
    await expect(
      session.handleWatchUpdate({ modifiedFiles: new Set([buttonPath]) })
    ).rejects.toThrow(/unexpected token/);

    expect(mocks.analyzeProject.mock.calls.length).toBe(analysesWhileOwed);
    session.close();
  });

  test('repeated failed reloads watch the last-good dependencies and only the current attempt', async () => {
    const root = createFixtureProject('animus-reload-growth-');
    mocks.analyzeProject.mockImplementation(() => buildManifest({}));
    const session = await developmentSession(root);
    const lastGood = [...session.systemDependencyPaths];
    const systemPath = join(root, 'src', 'system.ts');
    mocks.analyzeProject.mockImplementation(() => {
      throw new Error('analysis boom');
    });

    const attempts = [0, 1, 2].map((n) => join(root, 'src', `palette${n}.ts`));
    for (const palette of attempts) {
      writeFileSync(palette, 'export const palette = {};\n');
      mocks.loadSystemModule.mockReturnValue({
        ...SYSTEM_CONFIG,
        dependencies: [systemPath, palette],
      });
      await expect(
        session.handleWatchUpdate({ modifiedFiles: new Set([systemPath]) })
      ).rejects.toThrow('analysis boom');
    }

    expect([...session.systemDependencyPaths].sort()).toEqual(
      [...new Set([...lastGood, systemPath, attempts[2]])].sort()
    );
    session.close();
  });

  test('a failed reload keeps last-good watch registration', async () => {
    const root = createFixtureProject('animus-reload-registration-');
    const logo = join(root, 'logo.svg');
    writeFileSync(logo, '<svg/>');
    const manifest = makeManifest({ css: '.btn{margin:8px}' });
    manifest.sheets.global = `@layer anm-global{body{background:url('animus-asset:${logo}')}}`;
    mocks.analyzeProject.mockImplementation(() => JSON.stringify(manifest));
    const session = await developmentSession(root);
    const watchedLogo = realpathSync(logo);
    expect([...session.assetDependencyPaths]).toEqual([watchedLogo]);

    // The reload loads a system that now reads palette.ts, then fails.
    const systemPath = join(root, 'src', 'system.ts');
    const palette = join(root, 'src', 'palette.ts');
    writeFileSync(palette, 'export const palette = {};\n');
    mocks.loadSystemModule.mockReturnValue({
      ...SYSTEM_CONFIG,
      dependencies: [systemPath, palette],
    });
    mocks.analyzeProject.mockImplementation(() => {
      throw new Error('analysis boom');
    });
    await expect(
      session.handleWatchUpdate({ modifiedFiles: new Set([systemPath]) })
    ).rejects.toThrow('analysis boom');

    expect([...session.assetDependencyPaths]).toEqual([watchedLogo]);
    expect(session.systemDependencyPaths).toContain(palette);
    session.close();
  });
});

// Rows 6 and 7: a path the load looked for and found absent counts, and so
// do the files a failed load read.
describe('the system load observations', () => {
  async function developmentSession(root: string) {
    const session = new ExtractionSession({ system: './src/system.ts' });
    session.rootDir = root;
    session.development = true;
    await session.runFullPipeline();
    return session;
  }

  test('creating a path the load found absent reloads the system', async () => {
    const root = createFixtureProject('animus-negative-observation-');
    const palette = join(root, 'src', 'palette.ts');
    mocks.analyzeProject.mockImplementation(() => buildManifest({}));
    mocks.loadSystemModule.mockReturnValue({
      ...SYSTEM_CONFIG,
      missing: [palette],
    });
    const session = await developmentSession(root);
    const loads = mocks.loadSystemModule.mock.calls.length;

    writeFileSync(palette, 'export const palette = {};\n');
    await session.handleWatchUpdate({ modifiedFiles: new Set([palette]) });

    expect(mocks.loadSystemModule.mock.calls.length).toBe(loads + 1);
    session.close();
  });

  test("a failed load's read files and absent paths stay watched", async () => {
    const root = createFixtureProject('animus-failed-load-reads-');
    mocks.analyzeProject.mockImplementation(() => buildManifest({}));
    const session = await developmentSession(root);
    const systemPath = join(root, 'src', 'system.ts');
    const palette = join(root, 'src', 'palette.ts');
    const absent = join(root, 'src', 'theme.ts');
    mocks.loadSystemModule.mockImplementation(() => {
      throw Object.assign(new Error('SyntaxError in palette.ts'), {
        dependencies: [systemPath, palette],
        missing: [absent],
      });
    });

    await expect(
      session.handleWatchUpdate({ modifiedFiles: new Set([systemPath]) })
    ).rejects.toThrow('palette.ts');

    expect(session.systemDependencyPaths).toContain(palette);
    expect(session.systemMissingPaths).toContain(absent);
    session.close();
  });
});
