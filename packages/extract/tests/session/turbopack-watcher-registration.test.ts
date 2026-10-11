/**
 * The fake watch goes through the orchestrator's seam because the runner's
 * module mocker cannot intercept fs builtins.
 */
import { EventEmitter } from 'events';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const engine = vi.hoisted(() => ({
  loadSystemModule: vi.fn(),
  analyzeProject: vi.fn(),
  clearAnalysisCache: vi.fn(),
}));

import {
  observationQueue,
  setEngineApiOverride,
  setWatchTransaction,
} from '../../session/singleton';

// Only the phase-replacement row runs real cycles; the rest stub them.
setEngineApiOverride(() => ({
  extractFacts: () => '{"files":{},"parseCount":0}',
  loadSystemModule: engine.loadSystemModule,
  analyzeProject: engine.analyzeProject,
  clearAnalysisCache: engine.clearAnalysisCache,
}));

import { ExtractionSession } from '../../session/extraction-session';
import { startTurbopackWatcher } from '../../session/turbopack-orchestrator';
import {
  buildManifest,
  disposeTempRoots,
  makeTempRoot,
  resetAnimusGlobals,
  SYSTEM_CONFIG,
} from './session-fixtures';

import type { WatchChanges } from '../../session/extraction-session';
import type {
  TurbopackWatcherHandle,
  TurbopackWatchOutcome,
} from '../../session/turbopack-orchestrator';
import type { FSWatcher, WatchListener, WatchOptions, watch } from 'fs';

class FakeWatcher extends EventEmitter implements FSWatcher {
  closed = false;

  constructor(
    readonly dir: string,
    readonly listener: WatchListener<string> | null
  ) {
    super();
  }

  close(): void {
    this.closed = true;
  }

  ref(): this {
    return this;
  }

  unref(): this {
    return this;
  }
}

const calls: Array<{ dir: string; recursive: boolean }> = [];
const watchers: FakeWatcher[] = [];

// SAFETY: `fs.watch` has four overloads, so no single signature is
// assignable; the seam is called as watchFn(dir, { recursive }, listener).
const fakeWatch = ((
  dir: string,
  opts?: WatchOptions | null,
  listener?: WatchListener<string | Buffer>
): FakeWatcher => {
  const watcher = new FakeWatcher(dir, listener ?? null);
  calls.push({ dir, recursive: Boolean(opts?.recursive) });
  watchers.push(watcher);
  return watcher;
}) as typeof watch;

// SAFETY: same seam contract as `fakeWatch`; this one models registration
// failure (no recursive fs.watch, or descriptor exhaustion) by throwing.
const failingWatch = ((): never => {
  throw new Error('ENOSYS: recursive fs.watch unavailable');
}) as typeof watch;

function startedHandle(outcome: TurbopackWatchOutcome): TurbopackWatcherHandle {
  if (outcome.kind !== 'started') {
    throw new Error(`expected a started watcher, got ${outcome.kind}`);
  }
  return outcome.handle;
}

function createProject(): string {
  const root = makeTempRoot('animus-turbo-reg-');
  for (const dir of ['src', 'app', 'node_modules/dep', '.next', '.animus']) {
    mkdirSync(join(root, dir), { recursive: true });
  }
  writeFileSync(join(root, 'next.config.ts'), 'export default {};\n');
  return root;
}

function makeSession(
  root: string,
  runCycle: (changes: WatchChanges) => Promise<void> = async () => {},
  build?: string
): ExtractionSession {
  const session = new ExtractionSession(
    { system: './src/system.ts' },
    { build }
  );
  session.rootDir = root;
  vi.spyOn(session, 'handleWatchUpdate').mockImplementation(runCycle);
  return session;
}

beforeEach(() => {
  calls.length = 0;
  watchers.length = 0;
  engine.loadSystemModule.mockReset().mockReturnValue({ ...SYSTEM_CONFIG });
  engine.analyzeProject.mockReset().mockImplementation(() => buildManifest({}));
  engine.clearAnalysisCache.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  disposeTempRoots();
});

describe('startTurbopackWatcher OS registration', () => {
  test('registers eligible top-level dirs only, never vendored trees', () => {
    const root = createProject();
    const handle = startedHandle(
      startTurbopackWatcher(makeSession(root), root, {
        debounceMs: 20,
        watchFn: fakeWatch,
      })
    );
    try {
      const registered = new Map(calls.map((c) => [c.dir, c.recursive]));
      // Non-recursive root (root-level files + new top-level directories),
      // recursive per source directory.
      expect(registered.get(root)).toBe(false);
      expect(registered.get(join(root, 'src'))).toBe(true);
      expect(registered.get(join(root, 'app'))).toBe(true);
      for (const dir of calls.map((c) => c.dir)) {
        expect(dir).not.toContain('node_modules');
        expect(dir).not.toContain('.next');
        expect(dir).not.toContain('.animus');
      }
    } finally {
      handle.close();
    }
    expect(watchers.every((w) => w.closed)).toBe(true);
  });

  test('an FSWatcher error degrades to no-watch and frees the root', () => {
    const root = createProject();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const handle = startedHandle(
      startTurbopackWatcher(makeSession(root), root, {
        debounceMs: 20,
        watchFn: fakeWatch,
      })
    );

    watchers[0].emit('error', new Error('EMFILE: too many open files'));

    expect(watchers.every((w) => w.closed)).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Turbopack dev watcher failed')
    );

    calls.length = 0;
    watchers.length = 0;
    const second = startedHandle(
      startTurbopackWatcher(makeSession(root), root, {
        debounceMs: 20,
        watchFn: fakeWatch,
      })
    );
    second.close();

    // close() after an error-triggered teardown is a no-op, not a throw.
    handle.close();
  });

  test('async death is observable on the handle: died flips and onDied fires once', () => {
    const root = createProject();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const handle = startedHandle(
      startTurbopackWatcher(makeSession(root), root, {
        debounceMs: 20,
        watchFn: fakeWatch,
      })
    );
    const deaths: number[] = [];
    handle.onDied = () => deaths.push(1);

    expect(handle.died).toBe(false);
    watchers[0].emit('error', new Error('ENOSPC: watch descriptors gone'));

    expect(handle.died).toBe(true);
    expect(deaths).toEqual([1]);

    calls.length = 0;
    watchers.length = 0;
    const second = startedHandle(
      startTurbopackWatcher(makeSession(root), root, {
        debounceMs: 20,
        watchFn: fakeWatch,
      })
    );
    second.close();
    expect(second.died).toBe(false);
  });

  test('settle() drains the in-flight update chain before resolving', async () => {
    const root = createProject();
    let releaseCycle!: () => void;
    const cycleGate = new Promise<void>((res) => {
      releaseCycle = res;
    });
    const events: string[] = [];
    const session = makeSession(root, async () => {
      events.push('cycle-start');
      await cycleGate;
      events.push('cycle-end');
    });
    const handle = startedHandle(
      startTurbopackWatcher(session, root, {
        debounceMs: 5,
        watchFn: fakeWatch,
      })
    );

    writeFileSync(join(root, 'src', 'a.tsx'), 'export {};');
    const srcWatcher = watchers.find((w) => w.dir === join(root, 'src'))!;
    srcWatcher.listener!('change', 'a.tsx');
    await vi.waitFor(() => expect(events).toContain('cycle-start'));

    handle.close();
    let settled = false;
    const settling = handle.settle().then(() => {
      settled = true;
    });
    await new Promise((res) => setTimeout(res, 10));
    expect(settled).toBe(false);
    releaseCycle();
    await settling;
    expect(events).toEqual(['cycle-start', 'cycle-end']);
  });

  test('an observation is recorded before the previous cycle settles', async () => {
    const restoreGlobals = resetAnimusGlobals();
    try {
      const root = createProject();
      writeFileSync(
        join(root, 'src', 'system.ts'),
        'export const system = {};\n'
      );
      const session = new ExtractionSession({ system: './src/system.ts' });
      session.rootDir = root;
      session.development = true;
      await session.runFullPipeline();

      // The first cycle stays in flight, as the watcher sees it, until
      // released.
      let release = (): void => {};
      const received: WatchChanges[] = [];
      const original = session.handleWatchUpdate.bind(session);
      vi.spyOn(session, 'handleWatchUpdate').mockImplementation((changes) => {
        received.push(changes);
        const settled = original(changes);
        if (received.length > 1) return settled;
        return settled.then(
          () =>
            new Promise<void>((resolve) => {
              release = resolve;
            })
        );
      });

      const handle = startedHandle(
        startTurbopackWatcher(session, root, {
          debounceMs: 5,
          watchFn: fakeWatch,
          holdEvents: true,
        })
      );
      const src = join(root, 'src');
      const srcWatcher = watchers.find((w) => w.dir === src)!;
      writeFileSync(join(src, 'a.tsx'), 'export {};');
      srcWatcher.listener!('change', 'a.tsx');
      void handle.deliverHeldEvents();
      writeFileSync(join(src, 'b.tsx'), 'export {};');
      srcWatcher.listener!('change', 'b.tsx');

      await vi.waitFor(() => expect(received).toHaveLength(2));
      expect(received[1].modifiedFiles).toEqual(new Set([join(src, 'b.tsx')]));

      release();
      handle.close();
      await handle.settle();
      session.close();
    } finally {
      restoreGlobals();
    }
  });

  test('a batch that arrives after close() never enters the session', async () => {
    const root = createProject();
    const entries: WatchChanges[] = [];
    const session = makeSession(root, async (changes) => {
      entries.push(changes);
    });
    const handle = startedHandle(
      startTurbopackWatcher(session, root, {
        debounceMs: 5,
        watchFn: fakeWatch,
      })
    );
    const srcWatcher = watchers.find((w) => w.dir === join(root, 'src'))!;

    // One event still in the window when close() cancels it, one after.
    writeFileSync(join(root, 'src', 'a.tsx'), 'export {};');
    srcWatcher.listener!('change', 'a.tsx');
    handle.close();
    writeFileSync(join(root, 'src', 'b.tsx'), 'export {};');
    srcWatcher.listener!('change', 'b.tsx');
    await new Promise((res) => setTimeout(res, 60));
    await handle.settle();

    expect(entries).toEqual([]);
  });

  // A replaced watcher must never feed a later session: phase replacement
  // closes the watcher and its session, and a detached session starts no
  // attempt, even for a batch it recorded before close.
  test('under a phase replacement, a batch recorded before close never starts an attempt, and the replacement never sees it', async () => {
    const restoreGlobals = resetAnimusGlobals();
    try {
      engine.analyzeProject.mockClear();
      const root = createProject();
      writeFileSync(
        join(root, 'src', 'system.ts'),
        'export const system = {};\n'
      );
      const dev = new ExtractionSession(
        { system: './src/system.ts' },
        { build: 'phase-replacement-dev' }
      );
      dev.rootDir = root;
      dev.development = true;
      await dev.runFullPipeline();
      const handle = startedHandle(
        startTurbopackWatcher(dev, root, { debounceMs: 5, watchFn: fakeWatch })
      );
      const srcWatcher = watchers.find((w) => w.dir === join(root, 'src'))!;

      // An attempt in flight, so the next batch is recorded and waits.
      let releaseInflight!: () => void;
      const inflight = new Promise<void>((res) => {
        releaseInflight = res;
      });
      setWatchTransaction(dev.key, inflight);
      const handed = vi.spyOn(dev, 'handleWatchUpdate');
      writeFileSync(join(root, 'src', 'b.tsx'), 'export {};');
      srcWatcher.listener!('change', 'b.tsx');
      await vi.waitFor(() => expect(handed).toHaveBeenCalledTimes(1));
      const analysesBeforeReplacement = engine.analyzeProject.mock.calls.length;

      // The replacement, as with-animus does for another phase.
      dev.close();
      handle.close();
      const production = new ExtractionSession(
        { system: './src/system.ts' },
        { build: 'phase-replacement-production' }
      );
      production.rootDir = root;
      await production.runFullPipeline();
      setWatchTransaction(dev.key, null);
      releaseInflight();
      await handle.settle();

      expect(engine.analyzeProject.mock.calls.length).toBe(
        analysesBeforeReplacement + 1
      );
      expect(observationQueue(production.key).untaken.size).toBe(0);
      production.close();
    } finally {
      restoreGlobals();
    }
  });
});

describe('project-watch claim outcomes', () => {
  test('a duplicate root claim is reported as such, never as a platform failure', () => {
    const root = createProject();
    const owner = makeSession(root);
    const first = startTurbopackWatcher(owner, root, {
      debounceMs: 20,
      watchFn: fakeWatch,
    });
    expect(first.kind).toBe('started');
    try {
      // Another participant of the same build; another build of the root
      // watches it for itself.
      const second = startTurbopackWatcher(
        makeSession(root, undefined, owner.sessionId),
        root,
        {
          debounceMs: 20,
          watchFn: fakeWatch,
        }
      );
      expect(second).toEqual({ kind: 'already-watched' });
    } finally {
      startedHandle(first).close();
    }
  });

  test('a failed registration reports unavailable and frees the root', () => {
    const root = createProject();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const outcome = startTurbopackWatcher(makeSession(root), root, {
      debounceMs: 20,
      watchFn: failingWatch,
    });
    expect(outcome).toEqual({ kind: 'unavailable' });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Turbopack dev watcher unavailable')
    );

    const retry = startTurbopackWatcher(makeSession(root), root, {
      debounceMs: 20,
      watchFn: fakeWatch,
    });
    expect(retry.kind).toBe('started');
    startedHandle(retry).close();
  });
});

describe('startTurbopackWatcher held delivery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const watcherFor = (dir: string): FakeWatcher => {
    const found = watchers.find((entry) => entry.dir === dir);
    if (!found) throw new Error(`no watcher registered for ${dir}`);
    return found;
  };

  const collectingSession = (
    root: string,
    batches: WatchChanges[]
  ): ExtractionSession =>
    makeSession(root, async (changes) => {
      batches.push(changes);
    });

  test('events observed while held are delivered once, on demand', async () => {
    const root = createProject();
    const batches: WatchChanges[] = [];
    const handle = startedHandle(
      startTurbopackWatcher(collectingSession(root, batches), root, {
        debounceMs: 20,
        watchFn: fakeWatch,
        holdEvents: true,
      })
    );
    const edited = join(root, 'src', 'Button.tsx');
    try {
      writeFileSync(edited, 'export const Button = 1;\n');
      watcherFor(join(root, 'src')).listener?.('change', 'Button.tsx');

      // Without the hold, events in the pre-analysis window are dropped or
      // joined to a running cycle that returns having analyzed none.
      vi.advanceTimersByTime(1000);
      await handle.settle();
      expect(batches).toEqual([]);

      await handle.deliverHeldEvents();
      expect(batches).toHaveLength(1);
      expect(batches[0].modifiedFiles?.has(edited)).toBe(true);

      await handle.deliverHeldEvents();
      expect(batches).toHaveLength(1);
    } finally {
      handle.close();
    }
  });

  test('the same injection without holdEvents is delivered on the debounce', async () => {
    // Positive control for the held-window negative above.
    const root = createProject();
    const batches: WatchChanges[] = [];
    const handle = startedHandle(
      startTurbopackWatcher(collectingSession(root, batches), root, {
        debounceMs: 20,
        watchFn: fakeWatch,
      })
    );
    const edited = join(root, 'src', 'Button.tsx');
    try {
      writeFileSync(edited, 'export const Button = 1;\n');
      watcherFor(join(root, 'src')).listener?.('change', 'Button.tsx');
      vi.advanceTimersByTime(1000);
      await handle.settle();
      expect(batches).toHaveLength(1);
      expect(batches[0].modifiedFiles?.has(edited)).toBe(true);
    } finally {
      handle.close();
    }
  });

  test('after delivery starts, later events take the ordinary debounce path', async () => {
    const root = createProject();
    const batches: WatchChanges[] = [];
    const handle = startedHandle(
      startTurbopackWatcher(collectingSession(root, batches), root, {
        debounceMs: 20,
        watchFn: fakeWatch,
        holdEvents: true,
      })
    );
    try {
      await handle.deliverHeldEvents();
      expect(batches).toEqual([]);

      const later = join(root, 'src', 'Later.tsx');
      writeFileSync(later, 'export const Later = 1;\n');
      watcherFor(join(root, 'src')).listener?.('change', 'Later.tsx');
      vi.advanceTimersByTime(1000);
      await handle.settle();
      expect(batches).toHaveLength(1);
      expect(batches[0].modifiedFiles?.has(later)).toBe(true);
    } finally {
      handle.close();
    }
  });
});
