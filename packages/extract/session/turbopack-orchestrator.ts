import { existsSync, readdirSync, statSync, watch } from 'fs';
import { join, relative } from 'path';

import { DEFAULT_WATCH_DEBOUNCE_MS } from './extraction-session';
import {
  ANIMUS_ARTIFACT_DIR,
  TURBOPACK_SYSTEM_PROPS_ID,
} from './session-paths';

import type { ExtractionSession } from './extraction-session';

export async function runSessionPipeline(
  session: ExtractionSession
): Promise<void> {
  session.systemPropsModuleId = TURBOPACK_SYSTEM_PROPS_ID;
  session.persistAnalysisInputs = true;
  await session.runFullPipeline();
}

const activeWatcherRoots = new Set<string>();

const IGNORED_SEGMENTS = new Set([
  ANIMUS_ARTIFACT_DIR,
  '.next',
  'node_modules',
]);

/** Registration failures meaning the OS is out of watch capacity: descriptor
 *  and inotify limits surface under all of these. */
const CAPACITY_CODES: ReadonlySet<string> = new Set([
  'EMFILE',
  'ENFILE',
  'ENOSPC',
  'EPERM',
]);

function errnoCode<Thrown>(error: Thrown): string | null {
  if (!(error instanceof Object) || !('code' in error)) return null;
  const { code } = error;
  return isIntrinsicString(code) ? code : null;
}

/** A primitive string, decided by the intrinsic tag. `Object(value) !== value`
 *  rejects boxed strings and a forged `Symbol.toStringTag`. */
function isIntrinsicString<Value>(value: Value): value is Value & string {
  return (
    Object(value) !== value &&
    Object.prototype.toString.call(value) === '[object String]'
  );
}

export interface TurbopackWatcherOptions {
  debounceMs?: number;
  watchFn?: typeof watch;
  /** Accumulate observed paths until `deliverHeldEvents()`: a cycle scheduled
   *  before the first analysis joins the running pipeline and does nothing. */
  holdEvents?: boolean;
}

export function startTurbopackWatcher(
  session: ExtractionSession,
  rootDir: string,
  options: TurbopackWatcherOptions = {}
): TurbopackWatchOutcome {
  const {
    debounceMs = DEFAULT_WATCH_DEBOUNCE_MS,
    watchFn = watch,
    holdEvents = false,
  } = options;
  if (activeWatcherRoots.has(rootDir)) return { kind: 'already-watched' };
  activeWatcherRoots.add(rootDir);

  // The ceiling must be published BEFORE the first deadline is computed, so
  // it is announced unconditionally.
  session.debounceCeilingMs = debounceMs;

  const pendingPaths = new Set<string>();
  const watchers = new Map<string, ReturnType<typeof watch>>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let updateChain: Promise<void> = Promise.resolve();
  let closed = false;
  let died = false;
  let holdingEvents = holdEvents;

  const externalWatchers = new Map<string, ReturnType<typeof watch>>();
  let pendingOpened = new Map<string, ReturnType<typeof watch>>();
  let capturedDuringSnapshot: string[] = [];

  const externalDiagnosticKey = (root: string): string =>
    `external-watch:${root}`;

  const failureReason = <Thrown>(err: Thrown): string => {
    const code = errnoCode(err);
    if (code !== null && CAPACITY_CODES.has(code)) return `capacity(${code})`;
    if (/inotify|too many/i.test(String(err))) return 'capacity';
    return code ?? 'error';
  };

  const degradeExternalRoot = <Thrown>(root: string, err: Thrown): void => {
    externalWatchers.get(root)?.close();
    externalWatchers.delete(root);
    pendingOpened.get(root)?.close();
    pendingOpened.delete(root);
    const message =
      `ANIMUS_EXTERNAL_WATCH_UNAVAILABLE root=${relative(rootDir, root)} ` +
      `reason=${failureReason(err)} effect=changes in this workspace ` +
      `source may require restart`;
    session.stickyDiagnostics?.set(externalDiagnosticKey(root), message);
    console.warn(`[animus-extract] ${message}`);
  };

  const flush = (): void => {
    timer = null;
    const modifiedFiles = new Set<string>();
    const removedFiles = new Set<string>();
    for (const path of pendingPaths) {
      (existsSync(path) ? modifiedFiles : removedFiles).add(path);
    }
    pendingPaths.clear();

    updateChain = updateChain.then(() => {
      // Clearing the debounce timer does not retract a thunk already chained
      // behind an in-flight cycle; entering the session after teardown races.
      if (closed) return;
      return session
        .handleWatchUpdate({ modifiedFiles, removedFiles })
        .catch((err) => {
          console.warn(`[animus-extract] watch update failed: ${String(err)}`);
        })
        .then(() => {
          if (pendingOpened.size > 0 || capturedDuringSnapshot.length > 0) {
            rollbackPendingExternal();
          }
        });
    });
  };

  const rollbackPendingExternal = (): void => {
    for (const watcher of pendingOpened.values()) {
      watcher.close();
    }
    pendingOpened = new Map();
    capturedDuringSnapshot = [];
  };

  const closeAll = (): void => {
    if (closed) return;
    closed = true;
    if (timer) clearTimeout(timer);
    timer = null;
    for (const watcher of watchers.values()) {
      watcher.close();
    }
    watchers.clear();
    for (const watcher of externalWatchers.values()) {
      watcher.close();
    }
    externalWatchers.clear();
    rollbackPendingExternal();
    session.onExternalRootResolved = null;
    session.onExternalRootsCommitted = null;
    activeWatcherRoots.delete(rootDir);
  };

  // Async FSWatcher errors are fatal to the process when unhandled, so the
  // root is freed and the death is published on the handle for its owner.
  const onWatcherError = <Thrown>(err: Thrown): void => {
    died = true;
    closeAll();
    console.warn(
      `[animus-extract] Turbopack dev watcher failed (${String(err)}); source edits require a dev-server restart`
    );
    handle.onDied?.();
  };

  const enqueuePath = (abs: string): void => {
    pendingPaths.add(abs);
    if (holdingEvents) return;
    try {
      session.noteDebouncedWatchEvents?.([abs]);
    } catch (err) {
      console.warn(
        `[animus-extract] Turbopack debounce status update failed: ${String(err)}`
      );
    }
    if (!timer) {
      timer = setTimeout(flush, debounceMs);
      timer.unref?.();
    }
  };

  const onEvent = (baseDir: string, filename: string | Buffer | null): void => {
    if (closed || !filename) return;
    const rel = filename.toString();
    // `.animus` writes would otherwise feed back into the watcher. Segment
    // match so bare directory events and nested node_modules are excluded.
    if (rel.split(/[\\/]/).some((segment) => IGNORED_SEGMENTS.has(segment))) {
      return;
    }
    const abs = join(baseDir, rel);
    if (baseDir === rootDir && !watchers.has(abs)) {
      try {
        if (statSync(abs).isDirectory()) addWatcher(abs, true);
      } catch {}
    }
    enqueuePath(abs);
  };

  const onExternalEvent = (
    root: string,
    self: () => ReturnType<typeof watch> | undefined,
    filename: string | Buffer | null
  ): void => {
    if (closed) return;
    const watcher = self();
    const active =
      watcher !== undefined && externalWatchers.get(root) === watcher;
    const isPending =
      watcher !== undefined && pendingOpened.get(root) === watcher;
    if (!active && !isPending) return;
    let abs: string;
    if (filename == null) {
      abs = root;
    } else {
      const rel = filename.toString();
      if (rel.split(/[\\/]/).some((segment) => IGNORED_SEGMENTS.has(segment))) {
        return;
      }
      abs = rel === '' ? root : join(root, rel);
    }
    if (isPending && !active) {
      capturedDuringSnapshot.push(abs);
      return;
    }
    enqueuePath(abs);
  };

  const openExternalWatcher = (
    root: string,
    into: Map<string, ReturnType<typeof watch>>
  ): void => {
    if (root.split(/[\\/]/).includes('node_modules')) return;
    try {
      let watcher: ReturnType<typeof watch> | undefined;
      watcher = watchFn(root, { recursive: true }, (_event, filename) =>
        onExternalEvent(root, () => watcher, filename)
      );
      watcher.on('error', (err) => degradeExternalRoot(root, err));
      watcher.unref?.();
      into.set(root, watcher);
      session.stickyDiagnostics?.delete(externalDiagnosticKey(root));
    } catch (err) {
      degradeExternalRoot(root, err);
    }
  };

  const addWatcher = (dir: string, recursive: boolean): void => {
    const watcher = watchFn(dir, { recursive }, (_event, filename) =>
      onEvent(dir, filename)
    );
    watcher.on('error', onWatcherError);
    watcher.unref?.();
    watchers.set(dir, watcher);
  };

  try {
    addWatcher(rootDir, false);
    for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || IGNORED_SEGMENTS.has(entry.name)) continue;
      addWatcher(join(rootDir, entry.name), true);
    }
  } catch (err) {
    // Recursive fs.watch is unavailable on Linux before Node 20: degrade to
    // no-watch instead of rejecting the config promise and killing the server.
    closeAll();
    console.warn(
      `[animus-extract] Turbopack dev watcher unavailable (${String(err)}); source edits require a dev-server restart`
    );
    return { kind: 'unavailable' };
  }

  for (const root of session.externalWatchRoots ?? []) {
    openExternalWatcher(root, externalWatchers);
  }

  session.onExternalRootResolved = (root: string): void => {
    if (closed) return;
    if (externalWatchers.has(root) || pendingOpened.has(root)) return;
    openExternalWatcher(root, pendingOpened);
  };
  session.onExternalRootsCommitted = (roots: string[]): void => {
    if (closed) return;
    const admitted = new Set(roots);
    for (const [root, watcher] of pendingOpened) {
      externalWatchers.set(root, watcher);
    }
    pendingOpened = new Map();
    for (const [root, watcher] of [...externalWatchers]) {
      if (!admitted.has(root)) {
        watcher.close();
        externalWatchers.delete(root);
      }
    }
    for (const abs of capturedDuringSnapshot.splice(0)) {
      enqueuePath(abs);
    }
  };

  const handle: TurbopackWatcherHandle = {
    close: closeAll,
    get died() {
      return died;
    },
    onDied: null,
    deliverHeldEvents: () => {
      holdingEvents = false;
      if (pendingPaths.size > 0) flush();
      return updateChain;
    },
    // After close() no new cycle can be scheduled, so awaiting this drains the
    // in-flight update — a shutdown must not remove the tree under it.
    settle: () => updateChain,
  };
  return { kind: 'started', handle };
}

export type TurbopackWatchOutcome =
  | { kind: 'started'; handle: TurbopackWatcherHandle }
  | { kind: 'already-watched' }
  | { kind: 'unavailable' };

export interface TurbopackWatcherHandle {
  close(): void;
  readonly died: boolean;
  onDied: (() => void) | null;
  settle(): Promise<void>;
  deliverHeldEvents(): Promise<void>;
}
