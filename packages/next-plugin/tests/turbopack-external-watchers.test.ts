/**
 * Turbopack external workspace-source watchers (openspec:
 * external-source-watch-ingestion, increment 02 — design D4/D7): per-root
 * recursive watchers over the admitted external roots, generation-fenced
 * reset reconciliation (open-new → snapshot → publish → replay →
 * close-old; rollback on failure), and per-root sticky degradation.
 *
 * A fake `watch` is injected through the orchestrator's seam (fs builtins
 * are not interceptable by the runner's module mocker); the session is a
 * REAL ExtractionSession with its analysis entry point replaced, whose
 * reset flow the tests drive through the seams the orchestrator installs
 * on it.
 */
import { EventEmitter } from 'events';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { ExtractionSession } from '../../extract/session/extraction-session';
import { startTurbopackWatcher } from '../../extract/session/turbopack-orchestrator';
import { disposeTempRoots, makeTempRoot } from './singleton-fixtures';

import type { FSWatcher, WatchListener, WatchOptions, watch } from 'fs';

/** The registered handle: a real `FSWatcher` surface (the orchestrator
 *  consumes `on('error')`, `unref()`, and `close()`) plus this scenario's
 *  event driver. */
class FakeWatcher extends EventEmitter implements FSWatcher {
  closed = false;

  constructor(
    readonly dir: string,
    private readonly listener: WatchListener<string | Buffer>
  ) {
    super();
  }

  /** Deliver one change event exactly as the OS watcher would. */
  trigger(filename: string | null): void {
    this.listener('change', filename);
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
/** Registration for these dirs throws a capacity error. */
const failDirs = new Set<string>();

// SAFETY: `fs.watch` publishes four overloads (buffer/encoding/string
// filenames); its assignability cannot be met by any single signature, so a
// seam fake must be asserted. This one is sound because
// startTurbopackWatcher calls the seam exactly once per root as
// `watchFn(root, { recursive: true }, listener)` and consumes only the
// FSWatcher members implemented above — see openExternalWatcher/addWatcher
// in packages/extract/session/turbopack-orchestrator.ts.
const fakeWatch = ((
  dir: string,
  opts?: WatchOptions | null,
  listener?: WatchListener<string | Buffer>
): FakeWatcher => {
  if (failDirs.has(dir)) {
    throw Object.assign(new Error('EMFILE: too many open files, watch'), {
      code: 'EMFILE',
    });
  }
  if (listener === undefined) {
    // The orchestrator always registers a listener; this fake's watchers are
    // event drivers, so a listener-less registration is a harness bug.
    throw new Error('external watcher registered without a listener');
  }
  const watcher = new FakeWatcher(dir, listener);
  calls.push({ dir, recursive: Boolean(opts?.recursive) });
  watchers.push(watcher);
  return watcher;
}) as typeof watch;

function watcherFor(dir: string): FakeWatcher | undefined {
  // Latest registration wins — reconciliation may re-register a dir.
  return [...watchers].reverse().find((w) => w.dir === dir);
}

function createTree() {
  const parent = makeTempRoot('animus-turbo-ext-');
  const root = join(parent, 'app');
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'next.config.ts'), 'export default {};\n');
  const kitA = join(parent, 'kits', 'a', 'src');
  const kitB = join(parent, 'kits', 'b', 'src');
  for (const kit of [kitA, kitB]) {
    mkdirSync(kit, { recursive: true });
    writeFileSync(join(kit, 'Button.tsx'), 'export const B = 1;\n');
  }
  return { root, kitA, kitB };
}

/** A real session carrying the admitted external roots, with its analysis
 *  entry point replaced: the orchestrator installs its reset seams on the
 *  genuine class and `updates` records the cycles it drives. */
function makeSession(root: string, roots: string[]) {
  const session = new ExtractionSession({ system: './src/system.ts' });
  session.rootDir = root;
  session.externalWatchRoots = roots;
  const updates = vi
    .spyOn(session, 'handleWatchUpdate')
    .mockImplementation(async () => {});
  return { session, updates };
}

type WatchUpdates = ReturnType<typeof makeSession>['updates'];

function start(session: ExtractionSession, root: string) {
  const outcome = startTurbopackWatcher(session, root, 20, fakeWatch);
  if (outcome.kind !== 'started') {
    throw new Error(`expected a started watcher, got ${outcome.kind}`);
  }
  return outcome.handle;
}

/** Modified-file sets across every handleWatchUpdate call. */
function allModified(updates: WatchUpdates): string[] {
  return updates.mock.calls.flatMap(([changes]) => [
    ...(changes.modifiedFiles ?? []),
  ]);
}

beforeEach(() => {
  calls.length = 0;
  watchers.length = 0;
  failDirs.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  disposeTempRoots();
});

describe('external root registration (design D4)', () => {
  test('admitted roots get recursive watchers; node_modules roots never do (G2)', () => {
    const { root, kitA } = createTree();
    const embedded = join(root, 'node_modules', 'dep', 'src');
    const { session } = makeSession(root, [kitA, embedded]);

    const handle = start(session, root);
    try {
      const registered = new Map(calls.map((c) => [c.dir, c.recursive]));
      expect(registered.get(kitA)).toBe(true);
      for (const dir of calls.map((c) => c.dir)) {
        expect(dir).not.toContain('node_modules');
      }
    } finally {
      handle!.close();
    }
    expect(watchers.every((w) => w.closed)).toBe(true);
  });

  test('kit file events flow into the session change sets', async () => {
    const { root, kitA } = createTree();
    const { session, updates } = makeSession(root, [kitA]);
    const handle = start(session, root);
    try {
      const kitWatcher = watcherFor(kitA);
      expect(kitWatcher).toBeDefined();
      kitWatcher!.trigger('Button.tsx');
      await vi.waitFor(() =>
        expect(allModified(updates)).toContain(join(kitA, 'Button.tsx'))
      );
    } finally {
      handle!.close();
    }
  });

  test('filename == null marks the root itself dirty for rediscovery', async () => {
    const { root, kitA } = createTree();
    const { session, updates } = makeSession(root, [kitA]);
    const handle = start(session, root);
    try {
      watcherFor(kitA)!.trigger(null);
      await vi.waitFor(() => expect(allModified(updates)).toContain(kitA));
    } finally {
      handle!.close();
    }
  });
});

describe('per-root degradation (design D7)', () => {
  test('a capacity failure degrades only the failing root with a sticky diagnostic', async () => {
    const { root, kitA, kitB } = createTree();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    failDirs.add(kitB);
    const { session, updates } = makeSession(root, [kitA, kitB]);

    const handle = start(session, root);
    try {
      // The healthy root still ingests.
      watcherFor(kitA)!.trigger('Button.tsx');
      await vi.waitFor(() =>
        expect(allModified(updates)).toContain(join(kitA, 'Button.tsx'))
      );
      // The sticky diagnostic names only the failing root, its reason,
      // and the effect.
      const sticky = [...session.stickyDiagnostics.values()].join('\n');
      expect(sticky).toContain('ANIMUS_EXTERNAL_WATCH_UNAVAILABLE');
      expect(sticky).toContain('kits/b/src');
      expect(sticky).not.toContain('kits/a/src');
      expect(sticky).toContain('EMFILE');
      expect(sticky).toContain('may require restart');
      expect(
        warn.mock.calls.some((c) =>
          String(c[0]).includes('ANIMUS_EXTERNAL_WATCH_UNAVAILABLE')
        )
      ).toBe(true);
    } finally {
      handle!.close();
    }
  });

  test('a later reset retries the failed registration and clears the diagnostic', async () => {
    const { root, kitA, kitB } = createTree();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    failDirs.add(kitB);
    const { session, updates } = makeSession(root, [kitA, kitB]);
    const handle = start(session, root);
    try {
      expect(session.stickyDiagnostics.size).toBe(1);

      // Reset reconciliation with the capacity pressure relieved.
      failDirs.clear();
      session.onExternalRootResolved!(kitA);
      session.onExternalRootResolved!(kitB);
      session.onExternalRootsCommitted!([kitA, kitB]);

      expect(session.stickyDiagnostics.size).toBe(0);
      watcherFor(kitB)!.trigger('Button.tsx');
      await vi.waitFor(() =>
        expect(allModified(updates)).toContain(join(kitB, 'Button.tsx'))
      );
    } finally {
      handle!.close();
    }
  });

  test('an async watcher error degrades that root only, not the project watch', async () => {
    const { root, kitA } = createTree();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { session } = makeSession(root, [kitA]);
    const handle = start(session, root);
    try {
      const kitWatcher = watcherFor(kitA)!;
      kitWatcher.emit(
        'error',
        new Error('ENOSPC: system limit for number of file watchers reached')
      );

      expect(kitWatcher.closed).toBe(true);
      // Project watchers survive — only the kit root degraded.
      expect(watcherFor(root)!.closed).toBe(false);
      expect([...session.stickyDiagnostics.values()].join('\n')).toContain(
        'ANIMUS_EXTERNAL_WATCH_UNAVAILABLE'
      );
      expect(
        warn.mock.calls.some((c) =>
          String(c[0]).includes('Turbopack dev watcher failed')
        )
      ).toBe(false);
    } finally {
      handle!.close();
    }
  });
});

describe('generation-fenced reset reconciliation (design D4)', () => {
  test('events captured during the snapshot replay after commit; removed roots are fenced', async () => {
    const { root, kitA, kitB } = createTree();
    const { session, updates } = makeSession(root, [kitA]);
    const handle = start(session, root);
    try {
      // Reset resolves a NEW root: its watcher opens immediately (no blind
      // gap), but events buffer until the generation publishes.
      session.onExternalRootResolved!(kitB);
      const kitBWatcher = watcherFor(kitB)!;
      expect(kitBWatcher).toBeDefined();
      kitBWatcher.trigger('Button.tsx');
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(allModified(updates)).not.toContain(join(kitB, 'Button.tsx'));

      // Publish: kitB admitted, kitA REMOVED from the universe.
      session.onExternalRootsCommitted!([kitB]);

      // The captured event replays into the ordinary flow.
      await vi.waitFor(() =>
        expect(allModified(updates)).toContain(join(kitB, 'Button.tsx'))
      );

      // The removed root's watcher is closed and its late events are
      // rejected by the generation fence.
      const kitAWatcher = watcherFor(kitA)!;
      expect(kitAWatcher.closed).toBe(true);
      updates.mockClear();
      kitAWatcher.trigger('Button.tsx');
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(allModified(updates)).not.toContain(join(kitA, 'Button.tsx'));
    } finally {
      handle!.close();
    }
  });

  test('a failed reset closes newly opened handles and drops captured events', async () => {
    const { root, kitA, kitB } = createTree();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { session, updates } = makeSession(root, [kitA]);
    // The reset transaction: resolves kitB mid-flight, then fails before
    // publishing — driven from inside handleWatchUpdate exactly like the
    // real session's geological reset.
    updates.mockImplementationOnce(async () => {
      session.onExternalRootResolved!(kitB);
      // onExternalRootsCommitted is never called — the reset fails.
      throw new Error('analysis failed');
    });

    const handle = start(session, root);
    try {
      // Trigger the transaction via an ordinary kitA event.
      watcherFor(kitA)!.trigger('Button.tsx');
      await vi.waitFor(() => expect(updates).toHaveBeenCalled());

      // Rollback: the newly opened handle is closed, captured events die
      // with it.
      const kitBWatcher = watcherFor(kitB)!;
      await vi.waitFor(() => expect(kitBWatcher.closed).toBe(true));
      updates.mockClear();
      kitBWatcher.trigger('Button.tsx');
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(allModified(updates)).not.toContain(join(kitB, 'Button.tsx'));
    } finally {
      handle!.close();
    }
  });
});
