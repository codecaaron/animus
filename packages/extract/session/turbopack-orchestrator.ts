import { existsSync, lstatSync, readdirSync, statSync, watch } from 'fs';
import { dirname, join, relative } from 'path';

import {
  isExcludedPackageRelativePath,
  isPathWithinRoot,
} from '../pipeline/index';
import { COALESCING_WINDOW_MS, CoalescingWindow } from './coalescing-window';
import {
  ANIMUS_ARTIFACT_DIR,
  TURBOPACK_SYSTEM_PROPS_ID,
} from './session-paths';

import type { ExtractionSession } from './extraction-session';

export async function runSessionPipeline(
  session: ExtractionSession
): Promise<void> {
  session.delivery = {
    ...session.delivery,
    systemPropsModuleId: TURBOPACK_SYSTEM_PROPS_ID,
  };
  session.persistAnalysisInputs = true;
  await session.runFullPipeline();
}

/** Each build's watched root: another build of the root watches it too. */
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

/** A directory tree under watch; closing it closes every watcher in it. */
interface TreeWatch {
  close(): void;
}

/**
 * Watches `root` and each directory under it that a kit's sources can live
 * in, one non-recursive watcher per directory, and never descends into
 * `node_modules` or another excluded path. A recursive watch would register
 * its whole tree before any filter ran: on Linux, Node watches every file
 * and directory, a kit's own dependencies included. Directories created
 * later are added; removed ones are closed. `onPath` receives each reported
 * path outside the excluded ones.
 */
function watchTree(
  root: string,
  watchFn: typeof watch,
  onPath: (abs: string) => void,
  onError: <Thrown>(err: Thrown) => void
): TreeWatch {
  const watchers = new Map<string, ReturnType<typeof watch>>();
  let closed = false;
  const excluded = (path: string): boolean => {
    const rel = relative(root, path);
    return (
      rel !== '' &&
      (isExcludedPackageRelativePath(rel) ||
        rel.split(/[\\/]/).some((segment) => IGNORED_SEGMENTS.has(segment)))
    );
  };
  const add = (dir: string): void => {
    if (closed || watchers.has(dir) || excluded(dir)) return;
    const watcher = watchFn(dir, { recursive: false }, (_event, name) => {
      if (closed) return;
      const abs = name == null ? dir : join(dir, name.toString());
      if (excluded(abs)) return;
      try {
        if (name == null) reconcile(dir);
        else follow(abs);
      } catch (err) {
        onError(err);
        return;
      }
      onPath(abs);
    });
    watcher.on('error', onError);
    watcher.unref?.();
    watchers.set(dir, watcher);
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) add(join(dir, entry.name));
    }
  };
  // Closes every watched directory at or under `path` but those in `keep`.
  const drop = (path: string, keep?: ReadonlySet<string>): void => {
    for (const [dir, watcher] of [...watchers]) {
      if (dir !== root && isPathWithinRoot(path, dir) && !keep?.has(dir)) {
        watcher.close();
        watchers.delete(dir);
      }
    }
  };
  // A created directory is watched; a removed one, and all under it, closed.
  // A link is never followed, as the initial walk follows none.
  const follow = (abs: string): void => {
    let isDirectory = false;
    try {
      isDirectory = lstatSync(abs).isDirectory();
    } catch {}
    if (isDirectory) add(abs);
    else drop(abs);
  };
  // `dir` and the directories under it as the initial walk finds them.
  const collect = (dir: string, into: Set<string>): void => {
    into.add(dir);
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const child = join(dir, entry.name);
      if (entry.isDirectory() && !excluded(child)) collect(child, into);
    }
  };
  // An event naming no entry: the subtree is read again, so created
  // directories are watched and removed ones closed.
  const reconcile = (dir: string): void => {
    const live = new Set<string>();
    try {
      collect(dir, live);
    } catch {
      drop(dir);
      return;
    }
    for (const path of live) add(path);
    drop(dir, live);
  };
  const close = (): void => {
    closed = true;
    for (const watcher of watchers.values()) watcher.close();
    watchers.clear();
  };
  try {
    add(root);
  } catch (err) {
    close();
    throw err;
  }
  return { close };
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
    debounceMs = COALESCING_WINDOW_MS,
    watchFn = watch,
    holdEvents = false,
  } = options;
  const watched = JSON.stringify([session.sessionId, rootDir]);
  if (activeWatcherRoots.has(watched)) return { kind: 'already-watched' };
  activeWatcherRoots.add(watched);

  // The ceiling must be published BEFORE the first deadline is computed, so
  // it is announced unconditionally.
  session.debounceCeilingMs = debounceMs;

  const pendingPaths = new Set<string>();
  const watchers = new Map<string, ReturnType<typeof watch>>();
  let updateChain: Promise<void> = Promise.resolve();
  let closed = false;
  let died = false;
  let holdingEvents = holdEvents;

  const externalWatchers = new Map<string, TreeWatch>();
  const dependencyWatchers = new Map<
    string,
    { watcher: ReturnType<typeof watch>; files: Set<string> }
  >();
  let pendingOpened = new Map<string, TreeWatch>();
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

  // This watcher's cycles that have not settled.
  let cyclesInFlight = 0;

  const flush = (): void => {
    const modifiedFiles = new Set<string>();
    const removedFiles = new Set<string>();
    for (const path of pendingPaths) {
      (existsSync(path) ? modifiedFiles : removedFiles).add(path);
    }
    pendingPaths.clear();
    if (closed) return;

    // Recorded now, before any promise is joined: the session's observation
    // queue runs it behind any cycle in flight.
    cyclesInFlight++;
    const cycle = session
      .handleWatchUpdate({ modifiedFiles, removedFiles })
      .catch((err) => {
        console.warn(`[animus-extract] watch update failed: ${String(err)}`);
      })
      .finally(() => {
        cyclesInFlight--;
        // A cycle still running may own the pending watchers.
        if (cyclesInFlight > 0) return;
        if (pendingOpened.size > 0 || capturedDuringSnapshot.length > 0) {
          rollbackPendingExternal();
        }
        syncDependencyWatchers();
      });
    updateChain = updateChain.then(() => cycle);
  };

  const coalescing = new CoalescingWindow(flush, debounceMs);

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
    coalescing.cancel();
    for (const watcher of watchers.values()) {
      watcher.close();
    }
    watchers.clear();
    for (const { watcher } of dependencyWatchers.values()) {
      watcher.close();
    }
    dependencyWatchers.clear();
    for (const watcher of externalWatchers.values()) {
      watcher.close();
    }
    externalWatchers.clear();
    rollbackPendingExternal();
    session.onExternalRootResolved = null;
    session.onExternalRootsCommitted = null;
    activeWatcherRoots.delete(watched);
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
    coalescing.note();
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
    self: () => TreeWatch | undefined,
    abs: string
  ): void => {
    if (closed) return;
    const watcher = self();
    const active =
      watcher !== undefined && externalWatchers.get(root) === watcher;
    const isPending =
      watcher !== undefined && pendingOpened.get(root) === watcher;
    if (!active && !isPending) return;
    if (isPending && !active) {
      capturedDuringSnapshot.push(abs);
      return;
    }
    enqueuePath(abs);
  };

  /** Watches one admitted root, an installed kit's under node_modules too:
   *  Turbopack transforms its edits, and the loader then waits on an
   *  analysis only this watcher schedules. Nothing else under node_modules
   *  is watched, the kit's own dependencies included. */
  const openExternalWatcher = (
    root: string,
    into: Map<string, TreeWatch>
  ): void => {
    try {
      let tree: TreeWatch | undefined;
      tree = watchTree(
        root,
        watchFn,
        (abs) => onExternalEvent(root, () => tree, abs),
        (err) => degradeExternalRoot(root, err)
      );
      into.set(root, tree);
      session.stickyDiagnostics?.delete(externalDiagnosticKey(root));
    } catch (err) {
      degradeExternalRoot(root, err);
    }
  };

  /** Whether the root or an external root watcher already reports `path`. */
  const watchedByRoot = (path: string): boolean => {
    if (
      isPathWithinRoot(rootDir, path) &&
      !relative(rootDir, path)
        .split(/[\\/]/)
        .some((segment) => IGNORED_SEGMENTS.has(segment))
    ) {
      return true;
    }
    return [...externalWatchers.keys()].some((root) =>
      isPathWithinRoot(root, path)
    );
  };

  /** Watches the Session's plan (its files, and the absent paths whose
   *  creation reloads the system) where no root watcher reports them, by
   *  their directories, for those paths only. */
  const syncDependencyWatchers = (): void => {
    if (closed) return;
    const wanted = new Map<string, Set<string>>();
    const plan = session.watchPlan();
    for (const path of [...plan.files, ...plan.missing]) {
      if (watchedByRoot(path)) continue;
      const files = wanted.get(dirname(path)) ?? new Set<string>();
      files.add(path);
      wanted.set(dirname(path), files);
    }
    for (const [dir, { watcher }] of [...dependencyWatchers]) {
      if (wanted.has(dir)) continue;
      watcher.close();
      dependencyWatchers.delete(dir);
    }
    for (const [dir, files] of wanted) {
      const existing = dependencyWatchers.get(dir);
      if (existing) {
        existing.files = files;
        continue;
      }
      try {
        const watcher = watchFn(dir, { recursive: false }, (_event, name) => {
          if (closed || !name) return;
          const abs = join(dir, name.toString());
          if (dependencyWatchers.get(dir)?.files.has(abs)) enqueuePath(abs);
        });
        watcher.on('error', (err) => {
          watcher.close();
          dependencyWatchers.delete(dir);
          console.warn(
            `[animus-extract] dependency watch on ${dir} failed (${String(err)}); its changes require a dev-server restart`
          );
        });
        watcher.unref?.();
        dependencyWatchers.set(dir, { watcher, files });
      } catch (err) {
        // A directory that does not exist yet holds only absent inputs.
        if (errnoCode(err) === 'ENOENT') continue;
        console.warn(
          `[animus-extract] dependency watch on ${dir} unavailable (${String(err)}); its changes require a dev-server restart`
        );
      }
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
  syncDependencyWatchers();

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
      // A watcher started before discovery learns the dependencies only
      // now, whether or not anything is pending, and sees no edit made
      // between the first load's read and this registration: one is queued
      // as an event, so it reloads the system after the first pass.
      syncDependencyWatchers();
      try {
        const changed = session.changedSystemDependency();
        if (changed !== undefined) enqueuePath(changed);
      } catch (err) {
        console.warn(
          `[animus-extract] Turbopack startup dependency check failed: ${String(err)}`
        );
      }
      // Startup bypasses the window.
      if (pendingPaths.size > 0) coalescing.flush();
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
