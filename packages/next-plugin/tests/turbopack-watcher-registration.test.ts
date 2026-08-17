/**
 * OS-registration and error-path pins for the Turbopack dev watcher (spec:
 * next-turbopack-integration / Dev watch re-extraction): vendored and
 * generated trees are never registered with the OS at all, and an
 * asynchronous FSWatcher 'error' event degrades to no-watch instead of
 * crashing the dev server. A fake watch is injected through the orchestrator's
 * test seam (fs builtins are not interceptable by the runner's module
 * mocker); event-flow behavior over the real fs lives in
 * turbopack-orchestrator.test.ts.
 */
import { EventEmitter } from 'events';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { ExtractionSession } from '../../extract/session/extraction-session';
import { startTurbopackWatcher } from '../../extract/session/turbopack-orchestrator';
import { disposeTempRoots, makeTempRoot } from './singleton-fixtures';

import type { WatchChanges } from '../../extract/session/extraction-session';
import type {
  TurbopackWatcherHandle,
  TurbopackWatchOutcome,
} from '../../extract/session/turbopack-orchestrator';
import type { FSWatcher, WatchListener, WatchOptions, watch } from 'fs';

/** The registered handle: a real `FSWatcher` surface (the orchestrator
 *  consumes `on('error')`, `unref()`, and `close()`) plus the registration
 *  bookkeeping this scenario asserts on. */
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

// SAFETY: `fs.watch` publishes four overloads (buffer/encoding/string
// filenames); its assignability cannot be met by any single signature, so a
// seam fake must be asserted. This one is sound because
// startTurbopackWatcher calls the seam exactly once per directory as
// `watchFn(dir, { recursive }, listener)` and consumes only the FSWatcher
// members implemented above — see addWatcher/openExternalWatcher in
// packages/extract/session/turbopack-orchestrator.ts.
const fakeWatch = ((
  dir: string,
  opts?: WatchOptions | null,
  listener?: WatchListener<string>
): FakeWatcher => {
  const watcher = new FakeWatcher(dir, listener ?? null);
  calls.push({ dir, recursive: Boolean(opts?.recursive) });
  watchers.push(watcher);
  return watcher;
}) as typeof watch;

// SAFETY: same seam contract as `fakeWatch` above — the orchestrator calls
// it as `watchFn(dir, { recursive }, listener)`; this one models the
// platform failure (recursive fs.watch unavailable / descriptor exhaustion
// at registration time) by throwing out of the very first registration.
const failingWatch = ((): never => {
  throw new Error('ENOSYS: recursive fs.watch unavailable');
}) as typeof watch;

/** The handle of a started claim — a test asserting on `close`/`settle`
 *  states which outcome it expects rather than assuming one. */
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

/** A real session with its analysis entry point replaced: these tests own
 *  registration, error, and drain paths only, so the pipeline behind
 *  handleWatchUpdate never runs. */
function makeSession(
  root: string,
  runCycle: (changes: WatchChanges) => Promise<void> = async () => {}
): ExtractionSession {
  const session = new ExtractionSession({ system: './src/system.ts' });
  session.rootDir = root;
  vi.spyOn(session, 'handleWatchUpdate').mockImplementation(runCycle);
  return session;
}

beforeEach(() => {
  calls.length = 0;
  watchers.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
  disposeTempRoots();
});

describe('startTurbopackWatcher OS registration', () => {
  test('registers eligible top-level dirs only, never vendored trees', () => {
    const root = createProject();
    const handle = startedHandle(
      startTurbopackWatcher(makeSession(root), root, 20, fakeWatch)
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
      startTurbopackWatcher(makeSession(root), root, 20, fakeWatch)
    );

    watchers[0].emit('error', new Error('EMFILE: too many open files'));

    expect(watchers.every((w) => w.closed)).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Turbopack dev watcher failed')
    );

    // The root is freed — a later session may start a fresh watcher.
    calls.length = 0;
    watchers.length = 0;
    const second = startedHandle(
      startTurbopackWatcher(makeSession(root), root, 20, fakeWatch)
    );
    second.close();

    // close() after an error-triggered teardown is a no-op, not a throw.
    handle.close();
  });

  test('async death is observable on the handle: died flips and onDied fires once', () => {
    const root = createProject();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const handle = startedHandle(
      startTurbopackWatcher(makeSession(root), root, 20, fakeWatch)
    );
    const deaths: number[] = [];
    handle.onDied = () => deaths.push(1);

    expect(handle.died).toBe(false);
    watchers[0].emit('error', new Error('ENOSPC: watch descriptors gone'));

    // The regression this pins: a process owner holding a live handle to a
    // dead watcher had no signal at all — the project watch read as active
    // and --fail-on-degraded could never trip post-registration.
    expect(handle.died).toBe(true);
    expect(deaths).toEqual([1]);

    // Caller-initiated close is NOT death.
    calls.length = 0;
    watchers.length = 0;
    const second = startedHandle(
      startTurbopackWatcher(makeSession(root), root, 20, fakeWatch)
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
      startTurbopackWatcher(session, root, 5, fakeWatch)
    );

    // Drive one event through the debounce into the update chain.
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
    // The in-flight transaction has not finished — settle must not have.
    expect(settled).toBe(false);
    releaseCycle();
    await settling;
    expect(events).toEqual(['cycle-start', 'cycle-end']);
  });

  test('a cycle queued before close() never enters the session', async () => {
    const root = createProject();
    let releaseCycle!: () => void;
    const cycleGate = new Promise<void>((res) => {
      releaseCycle = res;
    });
    const entries: string[] = [];
    const session = makeSession(root, async () => {
      entries.push('cycle');
      await cycleGate;
    });
    const outcome = startTurbopackWatcher(session, root, 5, fakeWatch);
    expect(outcome.kind).toBe('started');
    const handle = startedHandle(outcome);
    const srcWatcher = watchers.find((w) => w.dir === join(root, 'src'))!;

    // Cycle 1 enters the session and blocks the serialized update chain.
    writeFileSync(join(root, 'src', 'a.tsx'), 'export {};');
    srcWatcher.listener!('change', 'a.tsx');
    await vi.waitFor(() => expect(entries).toEqual(['cycle']));

    // Cycle 2 flushes behind it: the debounce timer is already gone by the
    // time close() runs, but the queued thunk is not.
    writeFileSync(join(root, 'src', 'b.tsx'), 'export {};');
    srcWatcher.listener!('change', 'b.tsx');
    await new Promise((res) => setTimeout(res, 60));

    handle.close();
    releaseCycle();
    await handle.settle();

    // The gap this pins: close() clears the debounce timer but the thunk
    // already chained carried no `closed` guard, so a cycle still entered
    // the session after teardown — the CLI watch stood a wrapper in front
    // of the session's own method to suppress it (report S8).
    expect(entries).toEqual(['cycle']);
  });
});

describe('project-watch claim outcomes', () => {
  test('a duplicate root claim is reported as such, never as a platform failure', () => {
    const root = createProject();
    const first = startTurbopackWatcher(makeSession(root), root, 20, fakeWatch);
    expect(first.kind).toBe('started');
    try {
      const second = startTurbopackWatcher(
        makeSession(root),
        root,
        20,
        fakeWatch
      );
      // The misreport this pins: a registry collision and a genuine platform
      // failure both returned `null`, so the CLI told the user the platform
      // watcher was unavailable and prescribed a restart that collides
      // identically (report S9).
      expect(second).toEqual({ kind: 'already-watched' });
    } finally {
      startedHandle(first).close();
    }
  });

  test('a failed registration reports unavailable and frees the root', () => {
    const root = createProject();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const outcome = startTurbopackWatcher(
      makeSession(root),
      root,
      20,
      failingWatch
    );
    expect(outcome).toEqual({ kind: 'unavailable' });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Turbopack dev watcher unavailable')
    );

    // Distinct from the duplicate claim above: the failed claim released the
    // root, so the next claim starts rather than colliding.
    const retry = startTurbopackWatcher(makeSession(root), root, 20, fakeWatch);
    expect(retry.kind).toBe('started');
    startedHandle(retry).close();
  });
});
