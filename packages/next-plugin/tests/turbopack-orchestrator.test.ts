/**
 * Behavior pins for the Turbopack orchestration path (spec:
 * next-turbopack-integration): config resolution completes the extraction
 * and leaves the full artifact set on disk; the dev watcher feeds
 * existence-partitioned change sets into the session. Engine mocked at the
 * singleton seam, same harness as plugin-pipeline.test.ts.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { ANIMUS_TURBOPACK_RULE_GLOB } from '../src/turbopack-config';
import { startTurbopackWatcher } from '../src/turbopack-orchestrator';
import { withAnimus } from '../src/with-animus';
import {
  BUTTON_SOURCE,
  resetAnimusGlobals,
  SYSTEM_CONFIG,
} from './singleton-fixtures';

import type { ExtractionSession } from '../src/extraction-session';

const mocks = vi.hoisted(() => ({
  loadSystemModule: vi.fn(),
  analyzeProject: vi.fn(),
  clearAnalysisCache: vi.fn(),
}));

vi.mock('../src/singleton', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/singleton')>();
  return {
    ...actual,
    engineApi: () => ({
      loadSystemModule: mocks.loadSystemModule,
      extractFacts: () => '{"files":{},"parseCount":0}',
      analyzeProject: mocks.analyzeProject,
      clearAnalysisCache: mocks.clearAnalysisCache,
    }),
  };
});

let restoreGlobals: () => void;
const tempRoots: string[] = [];
let savedCwd: string;

const MANIFEST = JSON.stringify({
  css: '.btn{margin:8;}',
  sheets: { global: '' },
  system_prop_map: {},
  dynamic_props: {},
  diagnostics: [],
});

function createProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'animus-turbo-orch-'));
  tempRoots.push(root);
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'system.ts'), 'export const system = {};\n');
  writeFileSync(join(root, 'src', 'Button.tsx'), BUTTON_SOURCE);
  return root;
}

beforeEach(() => {
  restoreGlobals = resetAnimusGlobals();
  savedCwd = process.cwd();
  mocks.loadSystemModule.mockReset().mockReturnValue({ ...SYSTEM_CONFIG });
  mocks.analyzeProject.mockReset().mockReturnValue(MANIFEST);
  mocks.clearAnalysisCache.mockReset();
});

afterEach(() => {
  process.chdir(savedCwd);
  restoreGlobals();
  vi.restoreAllMocks();
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('withAnimus Turbopack wiring', () => {
  test('inactive mode returns synchronously with no turbopack keys', () => {
    const root = createProject();
    process.chdir(root);
    const config = withAnimus({ system: './src/system.ts' })({});
    expect(config).not.toBeInstanceOf(Promise);
    expect((config as Record<string, unknown>).turbopack).toBeUndefined();
  });

  test('active mode resolves after the session artifact set exists and merges config', async () => {
    const root = createProject();
    process.chdir(root);

    const pending = withAnimus({
      system: './src/system.ts',
      unstable_turbopack: { mode: 'on' },
    })({});
    expect(pending).toBeInstanceOf(Promise);
    const config = await pending;

    const turbopack = (config as Record<string, unknown>).turbopack as {
      rules: Record<
        string,
        {
          loaders: Array<{
            options: { sessionId?: string; sessionDir?: string };
          }>;
        }
      >;
      resolveAlias: Record<string, string>;
    };
    expect(turbopack.rules[ANIMUS_TURBOPACK_RULE_GLOB]).toBeDefined();
    const options =
      turbopack.rules[ANIMUS_TURBOPACK_RULE_GLOB].loaders[0].options;
    // process.cwd() resolves the macOS /var → /private/var symlink
    expect(options).toMatchObject({ rootDir: realpathSync(root) });
    // Session identity travels via loader options (design D2).
    expect(options.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    const sessionDir = options.sessionDir!;
    expect(sessionDir).toBe(
      join(realpathSync(root), '.animus', 'sessions', options.sessionId!)
    );

    for (const artifact of [
      'styles.css',
      'system-props.js',
      'manifest.json',
      'analysis-inputs.json',
      'analysis-commit',
      'analysis-status.json',
    ]) {
      expect(existsSync(join(sessionDir, artifact)), artifact).toBe(true);
      // Flat legacy paths are gone.
      expect(existsSync(join(root, '.animus', artifact)), artifact).toBe(false);
    }

    // The hydration artifact replays the exact analyze-time inputs
    const inputs = JSON.parse(
      readFileSync(join(sessionDir, 'analysis-inputs.json'), 'utf-8')
    );
    const files = JSON.parse(inputs.filesJson) as Array<{
      path: string;
      source: string;
    }>;
    expect(files.find((f) => f.path === 'src/Button.tsx')?.source).toBe(
      BUTTON_SOURCE
    );
    expect(inputs.devMode).toBe(false);
    // The disk manifest is the engine manifest plus the session envelope.
    const diskManifest = JSON.parse(
      readFileSync(join(sessionDir, 'manifest.json'), 'utf-8')
    );
    expect(diskManifest).toEqual({
      __animusSession: expect.objectContaining({
        sessionId: options.sessionId,
      }),
      ...JSON.parse(MANIFEST),
    });

    // Aliases point into the session-scoped tree.
    expect(turbopack.resolveAlias['virtual:animus/system-props']).toBe(
      `./.animus/sessions/${options.sessionId}/system-props.js`
    );
    expect(turbopack.resolveAlias['.animus/styles.css']).toBe(
      `./.animus/sessions/${options.sessionId}/styles.css`
    );
  });

  test('a same-session re-analysis never rewrites byte-identical artifacts', async () => {
    const root = createProject();
    process.chdir(root);

    const first = await withAnimus({
      system: './src/system.ts',
      unstable_turbopack: { mode: 'on' },
    })({});
    const sessionDir = (
      (first as Record<string, unknown>).turbopack as {
        rules: Record<
          string,
          { loaders: Array<{ options: { sessionDir?: string } }> }
        >;
      }
    ).rules[ANIMUS_TURBOPACK_RULE_GLOB].loaders[0].options.sessionDir!;

    // bigint stat: write-then-rename gives a rewritten artifact a new inode,
    // so ino+mtimeNs equality proves the file was left untouched.
    const statOf = (name: string) => {
      const s = statSync(join(sessionDir, name), { bigint: true });
      return { ino: s.ino, mtimeNs: s.mtimeNs };
    };
    const before = {
      manifest: statOf('manifest.json'),
      inputs: statOf('analysis-inputs.json'),
      commit: statOf('analysis-commit'),
    };

    // A second config resolution in the SAME process (Next dev re-evaluates
    // the config): the new session instance adopts the process-claimed
    // identity and re-analyzes identical content over the same session dir.
    await withAnimus({
      system: './src/system.ts',
      unstable_turbopack: { mode: 'on' },
    })({});

    expect(statOf('manifest.json')).toEqual(before.manifest);
    expect(statOf('analysis-inputs.json')).toEqual(before.inputs);
    expect(statOf('analysis-commit')).toEqual(before.commit);
  });

  test('a consumer rule on the Animus glob is a hard error', async () => {
    const root = createProject();
    process.chdir(root);

    await expect(
      withAnimus({
        system: './src/system.ts',
        unstable_turbopack: { mode: 'on' },
      })({
        turbopack: {
          rules: { [ANIMUS_TURBOPACK_RULE_GLOB]: { loaders: [] } },
        },
      })
    ).rejects.toThrow('already configured');
  });
});

type WatchChanges = {
  modifiedFiles: Set<string>;
  removedFiles: Set<string>;
};

describe('startTurbopackWatcher', () => {
  test('feeds debounced, existence-partitioned change sets to the session', async () => {
    const root = createProject();
    const handleWatchUpdate = vi.fn<(changes: WatchChanges) => Promise<void>>(
      async () => {}
    );
    const session = { handleWatchUpdate } as unknown as ExtractionSession;

    const watcher = startTurbopackWatcher(session, root, 20);
    expect(watcher).not.toBeNull();
    try {
      let stamp = 0;
      await vi.waitFor(
        () => {
          // Re-arm the trigger on every poll: FSEvents registration can lag
          // under parallel suite load, and a one-shot write that lands
          // before the watcher is live would never be delivered.
          writeFileSync(
            join(root, 'src', 'New.tsx'),
            `export const N = ${stamp++};\n`
          );
          expect(
            handleWatchUpdate.mock.calls.some((c) =>
              c[0].modifiedFiles.has(join(root, 'src', 'New.tsx'))
            )
          ).toBe(true);
        },
        { timeout: 10000, interval: 250 }
      );

      rmSync(join(root, 'src', 'New.tsx'));
      await vi.waitFor(
        () =>
          expect(
            handleWatchUpdate.mock.calls.some((c) =>
              c[0].removedFiles.has(join(root, 'src', 'New.tsx'))
            )
          ).toBe(true),
        { timeout: 10000 }
      );
    } finally {
      watcher!.close();
    }
    // FSEvents registration + delivery latency under parallel suite load.
  }, 30000);

  test('debounce-window events surface as debouncing status evidence before the flush', async () => {
    const root = createProject();
    // A REAL session (no analysis runs — the huge debounce keeps the flush
    // away): the watcher must feed its observations into the session's
    // status file so loaders ahead of the analysis can wait on evidence
    // (design D3 'debouncing').
    const { ExtractionSession } = await import('../src/extraction-session');
    const session = new ExtractionSession({ system: './src/system.ts' });
    session.rootDir = root;

    const watcher = startTurbopackWatcher(session, root, 60_000);
    expect(watcher).not.toBeNull();
    try {
      // The watcher's debounce is the status deadline's ceiling.
      expect(session.debounceCeilingMs).toBe(60_000);

      const statusPath = join(session.sessionDir, 'analysis-status.json');
      let stamp = 0;
      await vi.waitFor(
        () => {
          // Re-arm per poll: FSEvents registration can lag under load.
          writeFileSync(
            join(root, 'src', 'Pending.tsx'),
            `export const P = ${stamp++};\n`
          );
          const status = JSON.parse(readFileSync(statusPath, 'utf-8')) as {
            state: string;
            sessionId: string;
            pending: Array<[string, string]>;
          };
          expect(status.state).toBe('debouncing');
          expect(status.sessionId).toBe(session.sessionId);
          expect(
            status.pending.some(([key]) => key === 'src/Pending.tsx')
          ).toBe(true);
        },
        { timeout: 10000, interval: 250 }
      );
    } finally {
      watcher!.close();
    }
  }, 30000);

  test('is idempotent per process and ignores .animus writes', async () => {
    const root = createProject();
    const handleWatchUpdate = vi.fn<(changes: WatchChanges) => Promise<void>>(
      async () => {}
    );
    const session = { handleWatchUpdate } as unknown as ExtractionSession;

    const first = startTurbopackWatcher(session, root, 20);
    const second = startTurbopackWatcher(session, root, 20);
    expect(second).toBeNull();
    try {
      // FSEvents may replay events from just before the watcher started —
      // let those flush, then measure only the .animus write.
      await new Promise((resolve) => setTimeout(resolve, 150));
      handleWatchUpdate.mockClear();

      mkdirSync(join(root, '.animus'), { recursive: true });
      writeFileSync(join(root, '.animus', 'styles.css'), '/* generated */');
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(handleWatchUpdate).not.toHaveBeenCalled();
    } finally {
      first!.close();
    }
  });
});

describe('deferred status write containment', () => {
  test('a failing deferred status write warns instead of escaping the microtask', async () => {
    const root = createProject();
    const { ExtractionSession } = await import('../src/extraction-session');
    const session = new ExtractionSession({ system: './src/system.ts' });
    session.rootDir = root;
    // Occupy `.animus` with a regular FILE: the deferred microtask's
    // mkdirSync(sessionDir) then throws ENOTDIR on the session's first-ever
    // artifact write — the path that used to run OUTSIDE the watch handler's
    // try/catch and reach the process as an uncaught exception, killing the
    // dev server.
    writeFileSync(join(root, '.animus'), 'not a directory\n');
    const warned: string[] = [];
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation((msg: unknown) => {
        warned.push(String(msg));
      });
    try {
      session.noteDebouncedWatchEvents([join(root, 'src', 'Button.tsx')]);
      // The status write is deferred to a microtask; let it run.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(
        warned.some((m) => m.includes('debounce status write failed'))
      ).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
