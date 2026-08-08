/**
 * Turbopack external workspace-source watchers (openspec:
 * external-source-watch-ingestion, increment 02 — design D4/D7): per-root
 * recursive watchers over the admitted external roots, generation-fenced
 * reset reconciliation (open-new → snapshot → publish → replay →
 * close-old; rollback on failure), and per-root sticky degradation.
 *
 * A fake `watch` is injected through the orchestrator's seam (fs builtins
 * are not interceptable by the runner's module mocker); the session is a
 * minimal fake whose reset flow the tests drive through the seams the
 * orchestrator installs on it.
 */
import { EventEmitter } from 'events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { startTurbopackWatcher } from '../src/turbopack-orchestrator';

import type { ExtractionSession } from '../src/extraction-session';
import type { watch } from 'fs';

type FakeWatcher = EventEmitter & {
  dir: string;
  closed: boolean;
  trigger(filename: string | null): void;
  close(): void;
  unref(): void;
};

const calls: Array<{ dir: string; recursive: boolean }> = [];
const watchers: FakeWatcher[] = [];
/** Registration for these dirs throws a capacity error. */
const failDirs = new Set<string>();

const fakeWatch = ((
  dir: string,
  opts: { recursive?: boolean } | undefined,
  listener: (event: string, filename: string | Buffer | null) => void
): FakeWatcher => {
  if (failDirs.has(dir)) {
    const err = new Error(
      'EMFILE: too many open files, watch'
    ) as NodeJS.ErrnoException;
    err.code = 'EMFILE';
    throw err;
  }
  const watcher: FakeWatcher = Object.assign(new EventEmitter(), {
    dir,
    closed: false,
    trigger(filename: string | null): void {
      listener('change', filename);
    },
    close(): void {
      watcher.closed = true;
    },
    unref(): void {},
  });
  calls.push({ dir, recursive: Boolean(opts?.recursive) });
  watchers.push(watcher);
  return watcher;
}) as unknown as typeof watch;

function watcherFor(dir: string): FakeWatcher | undefined {
  // Latest registration wins — reconciliation may re-register a dir.
  return [...watchers].reverse().find((w) => w.dir === dir);
}

const tempRoots: string[] = [];

function createTree(): { root: string; kitA: string; kitB: string } {
  const parent = mkdtempSync(join(tmpdir(), 'animus-turbo-ext-'));
  tempRoots.push(parent);
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

interface FakeSession {
  externalWatchRoots: string[];
  stickyDiagnostics: Map<string, string>;
  handleWatchUpdate: ReturnType<typeof vi.fn>;
  onExternalRootResolved: ((root: string) => void) | null;
  onExternalRootsCommitted: ((roots: string[]) => void) | null;
}

function makeSession(roots: string[]): FakeSession {
  return {
    externalWatchRoots: roots,
    stickyDiagnostics: new Map(),
    handleWatchUpdate: vi.fn(async () => {}),
    onExternalRootResolved: null,
    onExternalRootsCommitted: null,
  };
}

function start(session: FakeSession, root: string) {
  return startTurbopackWatcher(
    session as unknown as ExtractionSession,
    root,
    20,
    fakeWatch
  );
}

/** Modified-file sets across every handleWatchUpdate call. */
function allModified(session: FakeSession): string[] {
  return session.handleWatchUpdate.mock.calls.flatMap((c) => [
    ...(c[0] as { modifiedFiles: Set<string> }).modifiedFiles,
  ]);
}

beforeEach(() => {
  calls.length = 0;
  watchers.length = 0;
  failDirs.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('external root registration (design D4)', () => {
  test('admitted roots get recursive watchers; node_modules roots never do (G2)', () => {
    const { root, kitA } = createTree();
    const embedded = join(root, 'node_modules', 'dep', 'src');
    const session = makeSession([kitA, embedded]);

    const handle = start(session, root);
    expect(handle).not.toBeNull();
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
    const session = makeSession([kitA]);
    const handle = start(session, root);
    try {
      const kitWatcher = watcherFor(kitA);
      expect(kitWatcher).toBeDefined();
      kitWatcher!.trigger('Button.tsx');
      await vi.waitFor(() =>
        expect(allModified(session)).toContain(join(kitA, 'Button.tsx'))
      );
    } finally {
      handle!.close();
    }
  });

  test('filename == null marks the root itself dirty for rediscovery', async () => {
    const { root, kitA } = createTree();
    const session = makeSession([kitA]);
    const handle = start(session, root);
    try {
      watcherFor(kitA)!.trigger(null);
      await vi.waitFor(() => expect(allModified(session)).toContain(kitA));
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
    const session = makeSession([kitA, kitB]);

    const handle = start(session, root);
    expect(handle).not.toBeNull();
    try {
      // The healthy root still ingests.
      watcherFor(kitA)!.trigger('Button.tsx');
      await vi.waitFor(() =>
        expect(allModified(session)).toContain(join(kitA, 'Button.tsx'))
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
    const session = makeSession([kitA, kitB]);
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
        expect(allModified(session)).toContain(join(kitB, 'Button.tsx'))
      );
    } finally {
      handle!.close();
    }
  });

  test('an async watcher error degrades that root only, not the project watch', async () => {
    const { root, kitA } = createTree();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const session = makeSession([kitA]);
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
    const session = makeSession([kitA]);
    const handle = start(session, root);
    try {
      // Reset resolves a NEW root: its watcher opens immediately (no blind
      // gap), but events buffer until the generation publishes.
      session.onExternalRootResolved!(kitB);
      const kitBWatcher = watcherFor(kitB)!;
      expect(kitBWatcher).toBeDefined();
      kitBWatcher.trigger('Button.tsx');
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(allModified(session)).not.toContain(join(kitB, 'Button.tsx'));

      // Publish: kitB admitted, kitA REMOVED from the universe.
      session.onExternalRootsCommitted!([kitB]);

      // The captured event replays into the ordinary flow.
      await vi.waitFor(() =>
        expect(allModified(session)).toContain(join(kitB, 'Button.tsx'))
      );

      // The removed root's watcher is closed and its late events are
      // rejected by the generation fence.
      const kitAWatcher = watcherFor(kitA)!;
      expect(kitAWatcher.closed).toBe(true);
      session.handleWatchUpdate.mockClear();
      kitAWatcher.trigger('Button.tsx');
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(allModified(session)).not.toContain(join(kitA, 'Button.tsx'));
    } finally {
      handle!.close();
    }
  });

  test('a failed reset closes newly opened handles and drops captured events', async () => {
    const { root, kitA, kitB } = createTree();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const session = makeSession([kitA]);
    // The reset transaction: resolves kitB mid-flight, then fails before
    // publishing — driven from inside handleWatchUpdate exactly like the
    // real session's geological reset.
    session.handleWatchUpdate.mockImplementationOnce(async () => {
      session.onExternalRootResolved!(kitB);
      // onExternalRootsCommitted is never called — the reset fails.
      throw new Error('analysis failed');
    });

    const handle = start(session, root);
    try {
      // Trigger the transaction via an ordinary kitA event.
      watcherFor(kitA)!.trigger('Button.tsx');
      await vi.waitFor(() =>
        expect(session.handleWatchUpdate).toHaveBeenCalled()
      );

      // Rollback: the newly opened handle is closed, captured events die
      // with it.
      const kitBWatcher = watcherFor(kitB)!;
      await vi.waitFor(() => expect(kitBWatcher.closed).toBe(true));
      session.handleWatchUpdate.mockClear();
      kitBWatcher.trigger('Button.tsx');
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(allModified(session)).not.toContain(join(kitB, 'Button.tsx'));
    } finally {
      handle!.close();
    }
  });
});
