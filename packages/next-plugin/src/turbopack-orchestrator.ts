import { existsSync, readdirSync, statSync, watch } from 'fs';
import { join } from 'path';

import { TURBOPACK_SYSTEM_PROPS_ID } from './turbopack-config';

import type { ExtractionSession } from './extraction-session';

/**
 * Out-of-band pipeline orchestration for Turbopack (spec:
 * next-turbopack-integration). Turbopack exposes no compiler hooks, so the
 * pipeline runs during next.config resolution and, in dev, from a
 * filesystem watcher — the bundler only ever sees the `.animus/` disk
 * artifacts.
 */

/** Run the full pipeline with the Turbopack emitter identity: hydration
 *  artifacts persisted, and the virtual system-props id (Turbopack rejects
 *  the webpack path's absolute-path imports). */
export async function runTurbopackPipeline(
  session: ExtractionSession
): Promise<void> {
  session.persistAnalysisInputs = true;
  session.systemPropsModuleId = TURBOPACK_SYSTEM_PROPS_ID;
  await session.runFullPipeline();
}

const activeWatcherRoots = new Set<string>();

const IGNORED_SEGMENTS = new Set(['.animus', '.next', 'node_modules']);

/**
 * Start the dev watcher: fs.watch per eligible top-level directory (plus a
 * non-recursive watch on the root itself), debounced into
 * existence-partitioned modified/removed sets feeding
 * `session.handleWatchUpdate` (serialized — updates never overlap).
 * Generated and vendored trees (`.animus`, `.next`, node_modules) are never
 * registered with the OS — recursive registration of those trees exhausts
 * inotify/kqueue descriptors (EMFILE/ENOSPC) on large projects.
 * Idempotent per project root; unref'd so it never holds the process open.
 * Asynchronous FSWatcher errors degrade to no-watch with a warning instead
 * of crashing the dev server. Returns a close handle, or null when this
 * root is already watched or the platform lacks recursive fs.watch (Linux
 * before Node 20 — degrades to no-watch with a warning).
 */
export function startTurbopackWatcher(
  session: ExtractionSession,
  rootDir: string,
  debounceMs = 75,
  // Test seam: fs builtins are not interceptable by the runner's module
  // mocker, so registration/error-path tests inject a fake here.
  watchFn: typeof watch = watch
): { close(): void } | null {
  if (activeWatcherRoots.has(rootDir)) return null;
  activeWatcherRoots.add(rootDir);

  const pendingPaths = new Set<string>();
  const watchers = new Map<string, ReturnType<typeof watch>>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let updateChain: Promise<void> = Promise.resolve();
  let closed = false;

  const flush = (): void => {
    timer = null;
    const modifiedFiles = new Set<string>();
    const removedFiles = new Set<string>();
    for (const path of pendingPaths) {
      (existsSync(path) ? modifiedFiles : removedFiles).add(path);
    }
    pendingPaths.clear();

    updateChain = updateChain.then(() =>
      session
        .handleWatchUpdate({ modifiedFiles, removedFiles })
        .catch((err) => {
          console.warn(
            `[animus-extract] Turbopack watch update failed: ${String(err)}`
          );
        })
    );
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
    activeWatcherRoots.delete(rootDir);
  };

  // FSWatcher errors arrive asynchronously (e.g. EMFILE/ENOSPC when the OS
  // runs out of watch descriptors) and are fatal to the process when
  // unhandled — free the root and degrade to no-watch instead.
  const onWatcherError = (err: unknown): void => {
    closeAll();
    console.warn(
      `[animus-extract] Turbopack dev watcher failed (${String(err)}); source edits require a dev-server restart`
    );
  };

  const onEvent = (baseDir: string, filename: string | Buffer | null): void => {
    if (closed || !filename) return;
    const rel = filename.toString();
    // Never react to generated or vendored trees — .animus writes would
    // otherwise feed back into the watcher. Segment match so the directory
    // entry itself (a bare `.animus` event) is ignored too, and so nested
    // node_modules inside watched top-level directories stay excluded.
    if (rel.split(/[\\/]/).some((segment) => IGNORED_SEGMENTS.has(segment))) {
      return;
    }
    const abs = join(baseDir, rel);
    // A top-level directory created mid-session needs its own recursive
    // watcher — the root watcher is non-recursive and would miss its contents.
    if (baseDir === rootDir && !watchers.has(abs)) {
      try {
        if (statSync(abs).isDirectory()) addWatcher(abs, true);
      } catch {
        // raced away or unwatchable — the event still reaches the pending set
      }
    }
    pendingPaths.add(abs);
    if (!timer) {
      timer = setTimeout(flush, debounceMs);
      timer.unref?.();
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
    // Recursive fs.watch is unavailable on Linux before Node 20 — degrade
    // to no-watch (edits need a dev-server restart) instead of rejecting
    // the config promise and killing the dev server.
    closeAll();
    console.warn(
      `[animus-extract] Turbopack dev watcher unavailable (${String(err)}); source edits require a dev-server restart`
    );
    return null;
  }

  return { close: closeAll };
}
