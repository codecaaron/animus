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

// Injection through the singleton's globalThis seam reaches every copy of
// the module (source or dist); a module mock does not.
setEngineApiOverride(() => ({
  extractFacts: () => '{"files":{},"parseCount":0}',
  loadSystemModule: mocks.loadSystemModule,
  analyzeProject: mocks.analyzeProject,
  clearAnalysisCache: mocks.clearAnalysisCache,
}));

let restoreGlobals: () => void;

const MANIFEST = JSON.stringify(makeManifest({ css: '.btn{margin:8;}' }));

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
    const { ExtractionSession } =
      await import('../../session/extraction-session');
    const session = new ExtractionSession({ system: './src/system.ts' });
    session.rootDir = root;
    const handleWatchUpdate = vi
      .spyOn(session, 'handleWatchUpdate')
      .mockImplementation(async () => {});

    const claim = startTurbopackWatcher(session, root, { debounceMs: 20 });
    expect(claim.kind).toBe('started');
    const watcher = startedHandle(claim);
    try {
      let stamp = 0;
      await vi.waitFor(
        () => {
          // Re-arm on every poll: FSEvents registration can lag under load,
          // and a write landing before it is live is never delivered.
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
    const { ExtractionSession } =
      await import('../../session/extraction-session');
    const session = new ExtractionSession({ system: './src/system.ts' });
    session.rootDir = root;

    // The 60s debounce keeps the flush away, so no analysis runs and the
    // status file is the only evidence under test.
    const watcher = startedHandle(
      startTurbopackWatcher(session, root, { debounceMs: 60_000 })
    );
    try {
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

    const first = startedHandle(
      startTurbopackWatcher(session, root, { debounceMs: 20 })
    );
    const second = startTurbopackWatcher(session, root, { debounceMs: 20 });
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
    // A regular file at `.animus` makes the deferred write throw ENOTDIR; it
    // runs outside the handler's try/catch, so an escape kills the server.
    writeFileSync(join(root, '.animus'), 'not a directory\n');
    const warned: string[] = [];
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
