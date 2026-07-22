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
  close(): void;
  unref(): void;
};

const calls: Array<{ dir: string; recursive: boolean }> = [];
const watchers: FakeWatcher[] = [];

const fakeWatch = ((
  dir: string,
  opts?: { recursive?: boolean }
): FakeWatcher => {
  const watcher: FakeWatcher = Object.assign(new EventEmitter(), {
    dir,
    closed: false,
    close(): void {
      watcher.closed = true;
    },
    unref(): void {},
  });
  calls.push({ dir, recursive: Boolean(opts?.recursive) });
  watchers.push(watcher);
  return watcher;
}) as unknown as typeof watch;

const tempRoots: string[] = [];

function createProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'animus-turbo-reg-'));
  tempRoots.push(root);
  for (const dir of ['src', 'app', 'node_modules/dep', '.next', '.animus']) {
    mkdirSync(join(root, dir), { recursive: true });
  }
  writeFileSync(join(root, 'next.config.ts'), 'export default {};\n');
  return root;
}

function makeSession(): ExtractionSession {
  return {
    handleWatchUpdate: vi.fn(async () => {}),
  } as unknown as ExtractionSession;
}

beforeEach(() => {
  calls.length = 0;
  watchers.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('startTurbopackWatcher OS registration', () => {
  test('registers eligible top-level dirs only, never vendored trees', () => {
    const root = createProject();
    const handle = startTurbopackWatcher(makeSession(), root, 20, fakeWatch);
    expect(handle).not.toBeNull();
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
      handle!.close();
    }
    expect(watchers.every((w) => w.closed)).toBe(true);
  });

  test('an FSWatcher error degrades to no-watch and frees the root', () => {
    const root = createProject();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const handle = startTurbopackWatcher(makeSession(), root, 20, fakeWatch);
    expect(handle).not.toBeNull();

    watchers[0].emit('error', new Error('EMFILE: too many open files'));

    expect(watchers.every((w) => w.closed)).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Turbopack dev watcher failed')
    );

    // The root is freed — a later session may start a fresh watcher.
    calls.length = 0;
    watchers.length = 0;
    const second = startTurbopackWatcher(makeSession(), root, 20, fakeWatch);
    expect(second).not.toBeNull();
    second!.close();

    // close() after an error-triggered teardown is a no-op, not a throw.
    handle!.close();
  });
});
