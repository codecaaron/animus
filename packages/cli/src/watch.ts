import { contentHash } from '@animus-ui/extract/pipeline';
import {
  getManifestJson,
  getSharedCss,
  getSharedSystemProps,
  startTurbopackWatcher,
} from '@animus-ui/extract/session';

import {
  createCliSession,
  createRunClaimRelease,
  err,
  ExtractionFailure,
  publishSharedPayloads,
  reportDiscoveryOutcomes,
  runPreflight,
} from './build';
import { installShutdownSignals } from './signals';
import { acquireLock, PublishSwapIncompleteError } from './writer';

import type { PublishOutcome } from './build';
import type { ResolvedCliConfig } from './config';
import type {
  ExtractionSession,
  TurbopackWatcherHandle,
  TurbopackWatchOutcome,
} from '@animus-ui/extract/session';

const EXIT_DEGRADED = 3;

export interface WatchFlags {
  failOnDegraded: boolean;
}

export interface DegradedRoot {
  root: string;
  reason: string;
}

export type ProjectWatchState = 'active' | 'unavailable' | 'already-watched';

const PROJECT_WATCH_REASONS = {
  unavailable:
    'platform watcher unavailable — NO source edits will be observed; restart the watch after changes',
  'already-watched':
    'root already claimed by another watcher in this process — NO source edits will be observed by THIS watch; run one watch per root (restarting collides the same way)',
} satisfies Record<Exclude<ProjectWatchState, 'active'>, string>;

export function collectDegradedRoots(inputs: {
  projectRoot: string;
  projectWatch: ProjectWatchState;
  externalWatchRoots: readonly string[];
  stickyDiagnostics: ReadonlyMap<string, string>;
}): DegradedRoot[] {
  const seen = new Set<string>();
  const degraded: DegradedRoot[] = [];
  const add = (root: string, reason: string): void => {
    if (seen.has(root)) return;
    seen.add(root);
    degraded.push({ root, reason });
  };

  if (inputs.projectWatch !== 'active') {
    add(inputs.projectRoot, PROJECT_WATCH_REASONS[inputs.projectWatch]);
  }
  for (const root of inputs.externalWatchRoots) {
    if (root.split(/[\\/]/).includes('node_modules')) {
      add(
        root,
        'resolved through node_modules (documented unwatchable) — edits in this package require a restart'
      );
    }
  }
  const stickyPrefix = 'external-watch:';
  for (const [key, message] of inputs.stickyDiagnostics) {
    if (!key.startsWith(stickyPrefix)) continue;
    add(key.slice(stickyPrefix.length), message);
  }
  return degraded;
}

export function formatDegradedRootLine(entry: DegradedRoot): string {
  return `watch degraded root=${entry.root} — ${entry.reason}`;
}

export function formatCyclePublishFailure<Thrown>(
  outDir: string,
  error: Thrown
): string {
  if (error instanceof PublishSwapIncompleteError) {
    return `watch cycle publication failed mid-swap — ${outDir} is NOT last-good: ${String(error)}`;
  }
  return `watch cycle publication rejected — keeping last-good artifacts in ${outDir}: ${String(error)}`;
}

function currentPayloadKey(): string {
  return [
    contentHash(getManifestJson() ?? ''),
    contentHash(getSharedCss()),
    contentHash(getSharedSystemProps()),
  ].join(':');
}

interface WatchStartup {
  session: ExtractionSession;
  claim: TurbopackWatchOutcome;
  publication: PublishOutcome;
}

/** Resolves with the process exit code at shutdown. Startup failures throw,
 *  so a supervisor sees either `watch ready` or a nonzero exit, never a hang. */
export async function runWatch(
  config: ResolvedCliConfig,
  flags: WatchFlags
): Promise<number> {
  const { outDir, root } = config;

  await runPreflight(config);

  const release = acquireLock(outDir);

  // The session tree survives while the watch runs — transform consumers
  // may read it — and is given up at the ending.
  let constructed: ExtractionSession | null = null;
  const releaseClaims = createRunClaimRelease(() => constructed, release);
  let watcher: TurbopackWatcherHandle | null = null;

  let startup: WatchStartup;
  try {
    const created = createCliSession(config);
    constructed = created;
    // Registered before the first analysis and holding what it observes:
    // the watcher never re-diffs, so an edit in that window never arrives.
    const claim = startTurbopackWatcher(created, root, { holdEvents: true });
    if (claim.kind === 'started') watcher = claim.handle;

    try {
      await created.runFullPipeline();
    } catch (error) {
      throw new ExtractionFailure(String(error));
    }
    const publication = publishSharedPayloads(config, created);
    reportDiscoveryOutcomes(config, created);
    startup = { session: created, claim, publication };
  } catch (error) {
    // The watcher registry is process-global: a startup failure that left
    // the root claimed makes the next in-process run report a duplicate.
    watcher?.close();
    releaseClaims();
    throw error;
  }

  const { session, claim } = startup;
  let lastPublication = startup.publication;
  let publications = 1;
  let lastPublishedKey = currentPayloadKey();

  return new Promise<number>((resolvePromise) => {
    // The session watcher unrefs every handle, so the CLI holds its own
    // ref'd keepalive as the process owner.
    const keepalive = setInterval(() => {}, 2 ** 30);

    let shuttingDown: Promise<void> | null = null;
    let finished = false;

    const reportShutdown = (reason: string, drain?: string): void => {
      err(
        `watch shutdown reason=${reason} publications=${publications}` +
          (drain === undefined ? '' : ` drain=${drain}`)
      );
    };

    const finish = (code: number, reason: string, drain?: string): void => {
      if (finished) return;
      finished = true;
      releaseClaims();
      // Removed only here: the listeners stay armed through the drain so a
      // second signal reaches the escalation, not the kernel default.
      removeShutdownSignals();
      // Cleared last: an otherwise-empty event loop would exit before the
      // lock release and tree removal ran.
      clearInterval(keepalive);
      reportShutdown(reason, drain);
      resolvePromise(code);
    };

    const drainThenFinish = async (
      code: number,
      reason: string
    ): Promise<void> => {
      watcher?.close();
      err(
        `watch shutdown starting reason=${reason} — draining the in-flight ` +
          `cycle before releasing ${outDir} (signal again to exit at once)`
      );
      // Drained before the tree is removed: an in-flight write re-creates
      // it (mkdirSync) after the removal and outlives the lock release.
      let bound: ReturnType<typeof setTimeout> | null = null;
      try {
        await Promise.race([
          watcher?.settle() ?? Promise.resolve(),
          new Promise<void>((res) => {
            bound = setTimeout(res, 10_000);
            bound.unref?.();
          }),
        ]);
      } catch {
        // A rejected cycle already reported itself.
      } finally {
        // An unref'd timer still holds its handle until it fires.
        if (bound !== null) clearTimeout(bound);
      }
      finish(code, reason);
    };

    const shutdown = (code: number, reason: string): Promise<void> => {
      if (shuttingDown !== null) return shuttingDown;
      shuttingDown = drainThenFinish(code, reason);
      return shuttingDown;
    };

    const removeShutdownSignals = installShutdownSignals({
      drain: shutdown,
      release: ({ exitCode, signal, abandoned }) => {
        if (!abandoned) return;
        err(
          `watch ${signal} during shutdown — abandoning the drain and ` +
            `releasing ${outDir}`
        );
        finish(exitCode, signal, 'abandoned');
      },
    });

    /** True when --fail-on-degraded tripped and shutdown has begun. */
    const reportDegradation = (): boolean => {
      // Liveness, not handle presence: a watcher that died after
      // registration (EMFILE/ENOSPC) leaves a handle observing nothing.
      const degraded = collectDegradedRoots({
        projectRoot: root,
        projectWatch:
          claim.kind === 'already-watched'
            ? 'already-watched'
            : watcher !== null && !watcher.died
              ? 'active'
              : 'unavailable',
        externalWatchRoots: session.externalWatchRoots,
        stickyDiagnostics: session.stickyDiagnostics,
      });
      for (const entry of degraded) {
        err(formatDegradedRootLine(entry));
      }
      if (degraded.length > 0 && flags.failOnDegraded) {
        err(
          `watch degraded and --fail-on-degraded is set — exiting ${EXIT_DEGRADED}`
        );
        void shutdown(EXIT_DEGRADED, 'fail-on-degraded');
        return true;
      }
      return false;
    };

    // Publication policy only; ingestion stays the session's. Assigned
    // before held events are delivered, so every cycle it drives is seen.
    session.onCycleSettled = (cause) => {
      if (shuttingDown !== null) return;
      if (cause !== null) {
        err(
          `watch cycle failed — keeping last-good artifacts in ${outDir}: ${String(cause)}`
        );
        return;
      }
      const key = currentPayloadKey();
      if (key === lastPublishedKey) return;
      let outcome: { componentCount: number; fileCount: number };
      try {
        outcome = publishSharedPayloads(config, session);
      } catch (error) {
        err(formatCyclePublishFailure(outDir, error));
        return;
      }
      lastPublishedKey = key;
      lastPublication = outcome;
      publications += 1;
      err(
        `watch republished components=${outcome.componentCount} files=${outcome.fileCount} outDir=${outDir}`
      );
      reportDegradation();
    };

    // A dead watcher drives no further cycles, so the per-publication
    // report would never run again; death reports once here instead.
    if (watcher) {
      watcher.onDied = () => {
        if (shuttingDown === null) reportDegradation();
      };
    }

    void (async () => {
      try {
        await watcher?.deliverHeldEvents();
      } catch {
        // A rejected cycle already reported itself through onCycleSettled.
      }
      if (shuttingDown !== null) return;

      // The degradation report precedes readiness, so an orchestrator
      // waiting on `watch ready` has already seen every unwatched root.
      if (reportDegradation()) return;

      err(
        `watch ready components=${lastPublication.componentCount} files=${lastPublication.fileCount} outDir=${outDir}`
      );
    })();
  });
}
