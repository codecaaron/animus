/**
 * Behavior pins for the Turbopack dev watcher's event flow (spec:
 * next-turbopack-integration, "Dev watch re-extraction"): a started
 * `startTurbopackWatcher` feeds debounced, existence-partitioned change sets
 * from real OS watchers into the session, surfaces debounce-window events as
 * status evidence before the flush, claims the project watch once per
 * process while ignoring `.animus` writes, and keeps a failing deferred
 * status write from escaping its microtask. Engine mocked at the singleton
 * seam. OS registration outcomes and the vendored/generated exclusions live
 * in turbopack-watcher-registration.test.ts; the `withAnimus` config wiring
 * that starts this watcher lives in
 * packages/next-plugin/tests/with-animus-turbopack.test.ts.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { startTurbopackWatcher } from '../../session/turbopack-orchestrator';
import {
  BUTTON_SOURCE,
  disposeTempRoots,
  makeManifest,
  makeTempRoot,
  resetAnimusGlobals,
  SYSTEM_CONFIG,
} from './session-fixtures';

import type {
  TurbopackWatcherHandle,
  TurbopackWatchOutcome,
} from '../../session/turbopack-orchestrator';
import type { JsonValue } from '@animus-ui/assertions';

const mocks = vi.hoisted(() => ({
  loadSystemModule: vi.fn(),
  analyzeProject: vi.fn(),
  clearAnalysisCache: vi.fn(),
}));

import { setEngineApiOverride } from '../../session/singleton';

// Engine API injection through the singleton's globalThis-keyed test
// seam — reaches every copy of the module (source or dist), which a
// module mock cannot.
setEngineApiOverride(() => ({
  extractFacts: () => '{"files":{},"parseCount":0}',
  loadSystemModule: mocks.loadSystemModule,
  analyzeProject: mocks.analyzeProject,
  clearAnalysisCache: mocks.clearAnalysisCache,
}));

let restoreGlobals: () => void;

/** What the engine double returns: a COMPLETE engine manifest carrying this
 *  suite's component CSS. The shared pipeline reads `manifest.sheets` /
 *  `manifest.components` directly, so a manifest that omits fields is not a
 *  manifest. */
const MANIFEST = JSON.stringify(makeManifest({ css: '.btn{margin:8;}' }));

/** The handle of a started claim — a test asserting on `close`/`settle`
 *  states which outcome it expects rather than assuming one. */
function startedHandle(outcome: TurbopackWatchOutcome): TurbopackWatcherHandle {
  if (outcome.kind !== 'started') {
    throw new Error(`expected a started watcher, got ${outcome.kind}`);
  }
  return outcome.handle;
}

function createProject(): string {
  const root = makeTempRoot('animus-turbo-watch-');
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'system.ts'), 'export const system = {};\n');
  writeFileSync(join(root, 'src', 'Button.tsx'), BUTTON_SOURCE);
  return root;
}

beforeEach(() => {
  restoreGlobals = resetAnimusGlobals();
  mocks.loadSystemModule.mockReset().mockReturnValue({ ...SYSTEM_CONFIG });
  mocks.analyzeProject.mockReset().mockReturnValue(MANIFEST);
  mocks.clearAnalysisCache.mockReset();
});

afterEach(() => {
  restoreGlobals();
  vi.restoreAllMocks();
  disposeTempRoots();
});

describe('startTurbopackWatcher', () => {
  test('feeds debounced, existence-partitioned change sets to the session', async () => {
    const root = createProject();
    // A real session with its analysis entry point replaced: this test owns
    // the watcher's change sets only, so the pipeline behind
    // handleWatchUpdate never runs.
    const { ExtractionSession } =
      await import('../../session/extraction-session');
    const session = new ExtractionSession({ system: './src/system.ts' });
    session.rootDir = root;
    const handleWatchUpdate = vi
      .spyOn(session, 'handleWatchUpdate')
      .mockImplementation(async () => {});

    const claim = startTurbopackWatcher(session, root, 20);
    expect(claim.kind).toBe('started');
    const watcher = startedHandle(claim);
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
              c[0].modifiedFiles?.has(join(root, 'src', 'New.tsx'))
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
              c[0].removedFiles?.has(join(root, 'src', 'New.tsx'))
            )
          ).toBe(true),
        { timeout: 10000 }
      );
    } finally {
      watcher.close();
    }
    // FSEvents registration + delivery latency under parallel suite load.
  }, 30000);

  test('debounce-window events surface as debouncing status evidence before the flush', async () => {
    const root = createProject();
    // A REAL session (no analysis runs — the huge debounce keeps the flush
    // away): the watcher must feed its observations into the session's
    // status file so loaders ahead of the analysis can wait on evidence
    // (design D3 'debouncing').
    const { ExtractionSession } =
      await import('../../session/extraction-session');
    const session = new ExtractionSession({ system: './src/system.ts' });
    session.rootDir = root;

    const watcher = startedHandle(startTurbopackWatcher(session, root, 60_000));
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
          const status: JsonValue = JSON.parse(
            readFileSync(statusPath, 'utf-8')
          );
          expect(status).toMatchObject({
            state: 'debouncing',
            sessionId: session.sessionId,
            pending: expect.arrayContaining([
              ['src/Pending.tsx', expect.any(String)],
            ]),
          });
        },
        { timeout: 10000, interval: 250 }
      );
    } finally {
      watcher.close();
    }
  }, 30000);

  test('is idempotent per process and ignores .animus writes', async () => {
    const root = createProject();
    const { ExtractionSession } =
      await import('../../session/extraction-session');
    const session = new ExtractionSession({ system: './src/system.ts' });
    session.rootDir = root;
    const handleWatchUpdate = vi
      .spyOn(session, 'handleWatchUpdate')
      .mockImplementation(async () => {});

    const first = startedHandle(startTurbopackWatcher(session, root, 20));
    const second = startTurbopackWatcher(session, root, 20);
    expect(second).toEqual({ kind: 'already-watched' });
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
      first.close();
    }
  });
});

describe('deferred status write containment', () => {
  test('a failing deferred status write warns instead of escaping the microtask', async () => {
    const root = createProject();
    const { ExtractionSession } =
      await import('../../session/extraction-session');
    const session = new ExtractionSession({ system: './src/system.ts' });
    session.rootDir = root;
    // Occupy `.animus` with a regular FILE: the deferred microtask's
    // mkdirSync(sessionDir) then throws ENOTDIR on the session's first-ever
    // artifact write — the path that used to run OUTSIDE the watch handler's
    // try/catch and reach the process as an uncaught exception, killing the
    // dev server.
    writeFileSync(join(root, '.animus'), 'not a directory\n');
    const warned: string[] = [];
    // The session's own warn path emits one preformatted line per call.
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation((message: string) => {
        warned.push(message);
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
