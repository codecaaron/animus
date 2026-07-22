import { existsSync, watch } from 'fs';
import { join } from 'path';

import type { ExtractionSession } from './extraction-session';

/**
 * Out-of-band pipeline orchestration for Turbopack (spec:
 * next-turbopack-integration). Turbopack exposes no compiler hooks, so the
 * pipeline runs during next.config resolution and, in dev, from a
 * filesystem watcher — the bundler only ever sees the `.animus/` disk
 * artifacts.
 */

/** Run the full pipeline with hydration-artifact persistence enabled. */
export async function runTurbopackPipeline(
  session: ExtractionSession
): Promise<void> {
  session.persistAnalysisInputs = true;
  await session.runFullPipeline();
}

const activeWatcherRoots = new Set<string>();

/**
 * Start the dev watcher: recursive fs.watch on the project root, debounced
 * into existence-partitioned modified/removed sets feeding
 * `session.handleWatchUpdate` (serialized — updates never overlap).
 * Idempotent per project root; unref'd so it never holds the process open.
 * Returns a close handle, or null when this root is already watched or the
 * platform lacks recursive fs.watch (Linux before Node 20 — degrades to
 * no-watch with a warning rather than crashing the dev server).
 */
export function startTurbopackWatcher(
  session: ExtractionSession,
  rootDir: string,
  debounceMs = 75
): { close(): void } | null {
  if (activeWatcherRoots.has(rootDir)) return null;
  activeWatcherRoots.add(rootDir);

  const pendingPaths = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let updateChain: Promise<void> = Promise.resolve();

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

  const IGNORED_SEGMENTS = new Set(['.animus', '.next', 'node_modules']);
  let watcher: ReturnType<typeof watch>;
  try {
    watcher = watch(rootDir, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      const rel = filename.toString();
      // Never react to generated or vendored trees — .animus writes would
      // otherwise feed back into the watcher. Segment match so the directory
      // entry itself (a bare `.animus` event) is ignored too.
      if (rel.split(/[\\/]/).some((segment) => IGNORED_SEGMENTS.has(segment))) {
        return;
      }
      const abs = join(rootDir, rel);
      pendingPaths.add(abs);
      if (!timer) {
        timer = setTimeout(flush, debounceMs);
        timer.unref?.();
      }
    });
  } catch (err) {
    // Recursive fs.watch is unavailable on Linux before Node 20 — degrade
    // to no-watch (edits need a dev-server restart) instead of rejecting
    // the config promise and killing the dev server.
    activeWatcherRoots.delete(rootDir);
    console.warn(
      `[animus-extract] Turbopack dev watcher unavailable (${String(err)}); source edits require a dev-server restart`
    );
    return null;
  }
  watcher.unref?.();

  return {
    close: () => {
      if (timer) clearTimeout(timer);
      watcher.close();
      activeWatcherRoots.delete(rootDir);
    },
  };
}
