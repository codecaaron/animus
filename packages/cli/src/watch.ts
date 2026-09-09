/**
 * `animus watch` — the session's watcher loop as a long-lived foreground
 * process (openspec: standalone-extraction-cli, design D5 watch half).
 *
 * Contract:
 * - Readiness is an explicit observable event distinct from idle: ONE
 *   structured stderr `watch ready` line after the first complete,
 *   consistent publication (plus the session status artifact's additive
 *   monotonic `ready` field, schema-bumped compatibly).
 * - Mid-run failures keep last-good output and report per-cycle on stderr;
 *   every publication goes through the SAME deterministic CLI writer as
 *   `animus build` (design D3) and the advisory lock is held for the
 *   watch's lifetime.
 * - Watch-capability degradation is loud and names roots: a persistent
 *   stderr warning per unwatched root at every publication, and
 *   `--fail-on-degraded` for orchestrators that would rather die (exit 3).
 * - The process stays alive on purpose: the session watcher unrefs every
 *   handle (it must never hold a plugin host's process open), so the CLI
 *   holds its own ref'd keepalive. SIGINT exits 130, SIGTERM 143, both
 *   releasing the lock and removing the session tree — a watch keeps its
 *   session tree alive WHILE RUNNING (transform consumers may exist) and
 *   removes it on clean shutdown, unlike build's publish-then-remove.
 *
 * COORDINATION: `external-source-watch-ingestion` owns watch-ingestion
 * semantics — this verb consumes `startTurbopackWatcher` and
 * `handleWatchUpdate` as-is (the per-cycle wrapper below only observes
 * cycle boundaries to drive publication policy; it forks no ingestion
 * behavior).
 */

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

/** The degraded-exit class: watch capability loss is an environment failure
 *  (taxonomy 3). Signal exit conventions live in signals.ts. */
const EXIT_DEGRADED = 3;

export interface WatchFlags {
  /** Exit (code 3) instead of running degraded when any root is unwatched. */
  failOnDegraded: boolean;
}

export interface DegradedRoot {
  root: string;
  reason: string;
}

/**
 * Whether this watch observes the project root, and if not, WHY — the two
 * failures have different remediations and must never be reported as one
 * (`unavailable` is fixed by restarting; a duplicate claim collides
 * identically on restart).
 */
export type ProjectWatchState = 'active' | 'unavailable' | 'already-watched';

/** The consequence of each non-observing project-watch state, in the
 *  user's terms. `unavailable` keeps its contracted wording. */
const PROJECT_WATCH_REASONS = {
  unavailable:
    'platform watcher unavailable — NO source edits will be observed; restart the watch after changes',
  'already-watched':
    'root already claimed by another watcher in this process — NO source edits will be observed by THIS watch; run one watch per root (restarting collides the same way)',
} satisfies Record<Exclude<ProjectWatchState, 'active'>, string>;

/**
 * The degradation list for one publication — every root whose edits the
 * watch will NOT observe, with the reason. Sources:
 * - the project root itself whenever its watch is not active: the platform
 *   watcher could not start (recursive fs.watch unavailable / registration
 *   failed / it died after registration), or another watcher in this
 *   process already claims the root;
 * - external roots resolved through node_modules (documented unwatchable —
 *   the orchestrator never registers them; its own guardrail-G2 comment on
 *   `openExternalWatcher`'s early return);
 * - external roots whose watcher failed after registration (the session's
 *   sticky `external-watch:` diagnostics, which carry the reason).
 */
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

/** One persistent stderr warning per unwatched root (design D5: loud,
 *  names the root and the consequence, repeated at every publication —
 *  never a one-shot). */
export function formatDegradedRootLine(entry: DegradedRoot): string {
  return `watch degraded root=${entry.root} — ${entry.reason}`;
}

/**
 * The per-cycle publication-failure report. The two endings must not share
 * wording: a rejection BEFORE the swap leaves the previous generation
 * byte-untouched, while a swap that already replaced names has destroyed it.
 */
export function formatCyclePublishFailure<Thrown>(
  outDir: string,
  error: Thrown
): string {
  if (error instanceof PublishSwapIncompleteError) {
    return `watch cycle publication failed mid-swap — ${outDir} is NOT last-good: ${String(error)}`;
  }
  return `watch cycle publication rejected — keeping last-good artifacts in ${outDir}: ${String(error)}`;
}

/** Composite key of the shared payload set — the cycle-level dedupe gate
 *  (a no-op analysis republishes nothing; disk bytes stay untouched). */
function currentPayloadKey(): string {
  return [
    contentHash(getManifestJson() ?? ''),
    contentHash(getSharedCss()),
    contentHash(getSharedSystemProps()),
  ].join(':');
}

/** What a watch's startup produced: the running session, the project-watch
 *  claim it took, and the counts of its first publication. */
interface WatchStartup {
  session: ExtractionSession;
  claim: TurbopackWatchOutcome;
  publication: PublishOutcome;
}

/**
 * Run the watch loop. Resolves with the process exit code on shutdown
 * (130 SIGINT / 143 SIGTERM / 3 --fail-on-degraded trip). Startup
 * failures — preflight, first pipeline, first publication — THROW with
 * the same taxonomy as build: readiness is a contract (NS3), so a
 * supervisor either observes the ready event or observes a nonzero exit,
 * never a silent hang with no first publication.
 */
export async function runWatch(
  config: ResolvedCliConfig,
  flags: WatchFlags
): Promise<number> {
  const { outDir, root } = config;

  await runPreflight(config);

  // D3: the advisory lock is held for the watch's LIFETIME — a concurrent
  // `animus build` against the same outDir fails loud instead of racing
  // the watch's publications. Released only on shutdown/startup failure.
  const release = acquireLock(outDir);

  // A watch keeps its session tree alive WHILE RUNNING (transform consumers
  // may exist) and gives it up at the ending — the CLI outDir is the
  // surviving artifact surface.
  let constructed: ExtractionSession | null = null;
  const releaseClaims = createRunClaimRelease(() => constructed, release);
  let watcher: TurbopackWatcherHandle | null = null;

  let startup: WatchStartup;
  try {
    const created = createCliSession(config);
    constructed = created;
    // Registered BEFORE the first analysis, holding what it observes: the
    // orchestrator registers claim state and watchers once and never
    // re-diffs against the analyzed hashes, so an edit landing in the
    // analysis window would otherwise be undeliverable forever.
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
    // Closed with the claim it took: `activeWatcherRoots` is process-global,
    // so a startup failure that left the root claimed would make the next
    // in-process run (programmatic `main()`) report a duplicate watcher.
    watcher?.close();
    // Startup failed before the loop: no reader exists for the session tree
    // the pipeline may have published, so the same two claims every other
    // ending gives up are given up here.
    releaseClaims();
    throw error;
  }

  const { session, claim } = startup;
  // What the LATEST publication produced: readiness is announced after the
  // held events are drained, so a drained edit that republished supersedes
  // the first publication's counts.
  let lastPublication = startup.publication;
  let publications = 1;
  let lastPublishedKey = currentPayloadKey();

  return new Promise<number>((resolvePromise) => {
    // The session watcher unrefs every handle by design — the CLI is the
    // process owner, so it holds its own ref'd keepalive.
    const keepalive = setInterval(() => {}, 2 ** 30);

    /** The ending in progress, or null while the loop is running. The FIRST
     *  ending wins: a signal arriving during another ending's drain joins
     *  that drain instead of starting a second one. */
    let shuttingDown: Promise<void> | null = null;
    let finished = false;

    /** The one terminal line every ending emits, so a supervisor parses one
     *  shape and learns which ending it got. */
    const reportShutdown = (reason: string, drain?: string): void => {
      err(
        `watch shutdown reason=${reason} publications=${publications}` +
          (drain === undefined ? '' : ` drain=${drain}`)
      );
    };

    /** Give up the claim and end the loop: the one ending, drained or
     *  abandoned. */
    const finish = (code: number, reason: string, drain?: string): void => {
      if (finished) return;
      finished = true;
      releaseClaims();
      // Removed only now: the listeners stay armed for the whole drain so a
      // second signal reaches the escalation instead of the kernel default.
      removeShutdownSignals();
      // Cleared LAST: the ref'd keepalive is what guarantees the process
      // survives the drain — an otherwise-empty event loop would exit
      // before the lock release and tree removal ran.
      clearInterval(keepalive);
      reportShutdown(reason, drain);
      resolvePromise(code);
    };

    const drainThenFinish = async (
      code: number,
      reason: string
    ): Promise<void> => {
      watcher?.close();
      // Announced BEFORE the drain, which can take as long as the in-flight
      // analysis: a second signal is the documented way out of a drain that
      // is taking too long.
      err(
        `watch shutdown starting reason=${reason} — draining the in-flight ` +
          `cycle before releasing ${outDir} (signal again to exit at once)`
      );
      // Drain the in-flight cycle BEFORE removing the session tree: an
      // extraction transaction still writing would otherwise re-create the
      // tree (writeSessionArtifact opens with mkdirSync) after the removal
      // and keep writing past the lock release. close() already stopped new
      // cycles; a bounded wait keeps a hung analysis from wedging shutdown.
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

    /** Begin an ending. Idempotent, and it resolves when the ending has
     *  finished, so a caller waiting on it (the signal owner's escalation
     *  window) stays open for the whole drain. */
    const shutdown = (code: number, reason: string): Promise<void> => {
      if (shuttingDown !== null) return shuttingDown;
      shuttingDown = drainThenFinish(code, reason);
      return shuttingDown;
    };

    const removeShutdownSignals = installShutdownSignals({
      drain: shutdown,
      release: ({ exitCode, signal, abandoned }) => {
        // A drained ending has already given up the claim from the drain's
        // own tail; only the abandoned one is left to end here.
        if (!abandoned) return;
        // The operator asked again: abandon the unfinished cycle, never the
        // claim. A process killed here leaves `lock.json` behind, and an
        // unprovably-dead lock is refused rather than stolen, so the next
        // run exits 2 over a directory nobody owns.
        err(
          `watch ${signal} during shutdown — abandoning the drain and ` +
            `releasing ${outDir}`
        );
        finish(exitCode, signal, 'abandoned');
      },
    });

    /** Print the per-publication degradation warnings. Returns true when
     *  --fail-on-degraded tripped (shutdown already initiated). */
    const reportDegradation = (): boolean => {
      // Liveness, not handle-presence: a watcher that DIED after
      // registration (post-registration EMFILE/ENOSPC) leaves a non-null
      // handle observing nothing. A duplicate claim is reported as itself:
      // it leaves this session unwired exactly like a platform failure does,
      // but restarting cannot fix it.
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

    // Per-cycle observation: publication policy ONLY — ingestion
    // (classification, debounce, serialization, external-root semantics)
    // stays entirely the session's, observed through its own cycle-boundary
    // seam. Installed before the watcher starts so every cycle it ever
    // drives is observed. Suppression after shutdown belongs to the
    // watcher's close() (no cycle is scheduled or entered past it); the
    // shutdown checks here cover only a cycle that outlived the handle.
    session.onCycleSettled = (cause) => {
      if (shuttingDown !== null) return; // cycle outlived the ending
      if (cause !== null) {
        // D5: mid-run failures keep last-good output and report per-cycle.
        err(
          `watch cycle failed — keeping last-good artifacts in ${outDir}: ${String(cause)}`
        );
        return;
      }
      const key = currentPayloadKey();
      if (key === lastPublishedKey) return; // no-op cycle — nothing new
      let outcome: { componentCount: number; fileCount: number };
      try {
        outcome = publishSharedPayloads(config, session);
      } catch (error) {
        // Structural emptiness / consistency failure of the NEW generation:
        // publishing it would be worse than keeping last-good.
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

    // A dead watcher produces no further cycles, so the per-publication
    // degradation report would never run again — report (and trip
    // --fail-on-degraded) at the moment of death instead. A death before
    // this assignment is still reported, since the report reads `died`.
    if (watcher) {
      watcher.onDied = () => {
        if (shuttingDown === null) reportDegradation();
      };
    }

    void (async () => {
      // Deliver what the watcher held during the first analysis, through the
      // ordinary cycle path above, so a file edited in that window is in the
      // artifacts BEFORE readiness is announced.
      try {
        await watcher?.deliverHeldEvents();
      } catch {
        // A rejected cycle already reported itself through onCycleSettled.
      }
      // A shutdown during the delivery already owns this loop's ending.
      if (shuttingDown !== null) return;

      // Startup degradation report precedes readiness so an orchestrator
      // waiting on `watch ready` has already seen every unwatched root.
      if (reportDegradation()) return;

      // D5: readiness is an explicit observable event distinct from idle —
      // exactly one structured stderr line, emitted only after the first
      // complete, consistent publication INCLUDING the drained window.
      err(
        `watch ready components=${lastPublication.componentCount} files=${lastPublication.fileCount} outDir=${outDir}`
      );
    })();
  });
}
