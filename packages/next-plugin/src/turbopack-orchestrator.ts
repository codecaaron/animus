import { existsSync, readdirSync, statSync, watch } from 'fs';
import { join, relative } from 'path';

import { TURBOPACK_SYSTEM_PROPS_ID } from './turbopack-config';

import type { ExtractionSession } from './extraction-session';

/**
 * Out-of-band pipeline orchestration for Turbopack (spec:
 * next-turbopack-integration). Turbopack exposes no compiler hooks, so the
 * pipeline runs during next.config resolution and, in dev, from a
 * filesystem watcher — the bundler only ever sees the `.animus/` disk
 * artifacts.
 */

/** Run the full pipeline with the Turbopack emitter identity: the virtual
 *  system-props id (Turbopack rejects the webpack path's absolute-path
 *  imports). Turbopack orchestration persists the analysis-inputs
 *  hydration corpus — its isolated loader workers replay it (spec:
 *  next-turbopack-integration, "Manifest disk artifact"; webpack mode
 *  skips the corpus). */
export async function runTurbopackPipeline(
  session: ExtractionSession
): Promise<void> {
  session.systemPropsModuleId = TURBOPACK_SYSTEM_PROPS_ID;
  session.persistAnalysisInputs = true;
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

  // The watcher's debounce is the ceiling the session's status deadlines
  // (and thereby the loader's catch-up waits) are derived from (design D3).
  if (typeof session.noteDebouncedWatchEvents === 'function') {
    session.debounceCeilingMs = debounceMs;
  }

  const pendingPaths = new Set<string>();
  const watchers = new Map<string, ReturnType<typeof watch>>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let updateChain: Promise<void> = Promise.resolve();
  let closed = false;

  // ── External workspace-source watchers (openspec:
  // external-source-watch-ingestion, design D4/D7) ──────────────────────
  // One recursive watcher per admitted external root (the narrowest
  // closure-complete discovery roots the session resolved). Reset
  // reconciliation is generation-fenced: the session announces each
  // re-resolved root BEFORE walking it (watcher opens into the pending
  // set, events buffer), publishes, then commits the admitted set (promote
  // pending → replay captured → close removed); an uncommitted attempt is
  // rolled back after its transaction settles.
  const externalWatchers = new Map<string, ReturnType<typeof watch>>();
  let pendingOpened = new Map<string, ReturnType<typeof watch>>();
  let capturedDuringSnapshot: string[] = [];

  const externalDiagnosticKey = (root: string): string =>
    `external-watch:${root}`;

  // Capacity exhaustion is recognized generally (design D7) — descriptor
  // and inotify limits surface under several codes, plus message-only
  // spellings on some platforms.
  const failureReason = (err: unknown): string => {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (
      code === 'EMFILE' ||
      code === 'ENFILE' ||
      code === 'ENOSPC' ||
      code === 'EPERM'
    ) {
      return `capacity(${code})`;
    }
    if (/inotify|too many/i.test(String(err))) return 'capacity';
    return code ?? 'error';
  };

  const degradeExternalRoot = (root: string, err: unknown): void => {
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

    updateChain = updateChain.then(() =>
      session
        .handleWatchUpdate({ modifiedFiles, removedFiles })
        .catch((err) => {
          console.warn(
            `[animus-extract] Turbopack watch update failed: ${String(err)}`
          );
        })
        .then(() => {
          // The transaction settled without committing a new root set —
          // roll back the open-new phase (design D4: rollback closes
          // newly opened handles on failure; captured events die with
          // their uncommitted generation).
          if (pendingOpened.size > 0 || capturedDuringSnapshot.length > 0) {
            rollbackPendingExternal();
          }
        })
    );
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

  // FSWatcher errors arrive asynchronously (e.g. EMFILE/ENOSPC when the OS
  // runs out of watch descriptors) and are fatal to the process when
  // unhandled — free the root and degrade to no-watch instead.
  const onWatcherError = (err: unknown): void => {
    closeAll();
    console.warn(
      `[animus-extract] Turbopack dev watcher failed (${String(err)}); source edits require a dev-server restart`
    );
  };

  const enqueuePath = (abs: string): void => {
    pendingPaths.add(abs);
    // Debounce-window evidence (design D3): record the observation in the
    // session's status file so a loader running ahead of the analysis can
    // wait on positive evidence instead of failing NOT_SCHEDULED. Optional
    // call — orchestration tests drive minimal session fakes.
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
    enqueuePath(abs);
  };

  /** External-root event path: fenced by watcher identity ({watcherRootId,
   *  generation} — a handle that is neither current nor pending belongs to
   *  a retired generation and its events are rejected), `filename == null`
   *  marks the ROOT dirty for rediscovery, and events observed while the
   *  root's generation is still snapshotting are buffered for replay. */
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

  /** Open one external-root watcher into `into` (the committed set at
   *  startup, the pending set during reset reconciliation). Failures
   *  degrade ONLY this root (design D7); node_modules-resident roots are
   *  documented unwatchable and never registered (guardrail G2). */
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
    // Recursive fs.watch is unavailable on Linux before Node 20 — degrade
    // to no-watch (edits need a dev-server restart) instead of rejecting
    // the config promise and killing the dev server.
    closeAll();
    console.warn(
      `[animus-extract] Turbopack dev watcher unavailable (${String(err)}); source edits require a dev-server restart`
    );
    return null;
  }

  // Cold start: the pipeline already resolved the admitted external roots —
  // register their watchers directly into the committed set (per-root
  // failures degrade individually, never the project watch).
  for (const root of session.externalWatchRoots ?? []) {
    openExternalWatcher(root, externalWatchers);
  }

  // Reset reconciliation seams (design D4): the session announces each
  // re-resolved root BEFORE walking it, and commits the admitted set after
  // publication. An announced-but-never-committed generation is rolled
  // back after its transaction settles (see flush).
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
    // Replay events captured while the generation was snapshotting.
    for (const abs of capturedDuringSnapshot.splice(0)) {
      enqueuePath(abs);
    }
  };

  return { close: closeAll };
}
