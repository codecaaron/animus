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
import { rmSync } from 'fs';

import {
  createCliSession,
  err,
  ExtractionFailure,
  publishSharedPayloads,
  reportDiscoveryOutcomes,
  runPreflight,
} from './build';
import { acquireLock } from './writer';

import type { ResolvedCliConfig } from './config';
import type {
  ExtractionSession,
  TurbopackWatcherHandle,
} from '@animus-ui/extract/session';

/** Signal exit conventions (128 + signal number) plus the degraded-exit
 *  class: watch capability loss is an environment failure (taxonomy 3). */
const EXIT_SIGINT = 130;
const EXIT_SIGTERM = 143;
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

/** Composite key of the shared payload set — the cycle-level dedupe gate
 *  (a no-op analysis republishes nothing; disk bytes stay untouched). */
function currentPayloadKey(): string {
  return [
    contentHash(getManifestJson() ?? ''),
    contentHash(getSharedCss()),
    contentHash(getSharedSystemProps()),
  ].join(':');
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

  let session!: ExtractionSession;
  let firstPublication: { componentCount: number; fileCount: number };
  try {
    session = createCliSession(config);
    try {
      await session.runFullPipeline();
    } catch (error) {
      throw new ExtractionFailure(String(error));
    }
    firstPublication = publishSharedPayloads(config, session);
    reportDiscoveryOutcomes(config, session);
  } catch (error) {
    release();
    // Startup failed before the loop: no reader exists for the session
    // tree the pipeline may have published — remove it. Only this run's
    // OWN tree: a construction failure leaves no session to ask, and the
    // process-global slot would then necessarily name a different
    // session's tree (nothing this call may delete).
    // SAFETY: `session` carries a definite-assignment assertion for the
    // loop below, but THIS catch is reachable from `createCliSession`
    // itself — the one point where the binding is still unassigned, which
    // only the widened read can observe.
    const started = session as ExtractionSession | undefined;
    const dir = started?.sessionDir;
    if (dir) rmSync(dir, { recursive: true, force: true });
    // Released with the tree it protected: a later in-process run
    // (programmatic `main()`) must find the publication claim free.
    started?.close();
    throw error;
  }

  let publications = 1;
  let lastPublishedKey = currentPayloadKey();

  return new Promise<number>((resolvePromise) => {
    let settled = false;
    // Assigned after the cycle observer below is installed; declared first
    // so shutdown and the degradation report can read them.
    let watcher: TurbopackWatcherHandle | null = null;
    let rootAlreadyWatched = false;

    // The session watcher unrefs every handle by design — the CLI is the
    // process owner, so it holds its own ref'd keepalive.
    const keepalive = setInterval(() => {}, 2 ** 30);

    const shutdown = (code: number, reason: string): void => {
      if (settled) return;
      settled = true;
      process.removeListener('SIGINT', onSigint);
      process.removeListener('SIGTERM', onSigterm);
      watcher?.close();
      void (async () => {
        // Drain the in-flight cycle BEFORE removing the session tree: an
        // extraction transaction still writing would otherwise re-create
        // the tree (writeSessionArtifact opens with mkdirSync) after the
        // removal and keep writing past the lock release. close() already
        // stopped new cycles; a bounded wait keeps a hung analysis from
        // wedging shutdown.
        try {
          await Promise.race([
            watcher?.settle() ?? Promise.resolve(),
            new Promise<void>((res) => setTimeout(res, 10_000).unref?.()),
          ]);
        } catch {
          // A rejected cycle already reported itself.
        }
        // A watch keeps its session tree alive while running (transform
        // consumers may exist); clean shutdown removes it — the CLI outDir
        // is the surviving artifact surface.
        try {
          rmSync(session.sessionDir, { recursive: true, force: true });
        } catch {
          // Best-effort: a missing tree is already gone.
        }
        // Released with the tree it protected: a later in-process run
        // (programmatic `main()`) must find the publication claim free.
        session.close();
        release();
        // Cleared LAST: the ref'd keepalive is what guarantees the process
        // survives the drain above — an otherwise-empty event loop would
        // exit before the lock release and tree removal ran.
        clearInterval(keepalive);
        err(`watch shutdown reason=${reason} publications=${publications}`);
        resolvePromise(code);
      })();
    };

    const onSigint = (): void => shutdown(EXIT_SIGINT, 'SIGINT');
    const onSigterm = (): void => shutdown(EXIT_SIGTERM, 'SIGTERM');
    process.on('SIGINT', onSigint);
    process.on('SIGTERM', onSigterm);

    /** Print the per-publication degradation warnings. Returns true when
     *  --fail-on-degraded tripped (shutdown already initiated). */
    const reportDegradation = (): boolean => {
      // Liveness, not handle-presence: a watcher that DIED after
      // registration (post-registration EMFILE/ENOSPC) leaves a non-null
      // handle observing nothing. Every caller runs after the claim, so a
      // handle-less state is one of the two claim failures — kept apart,
      // because only one of them is fixed by restarting.
      const degraded = collectDegradedRoots({
        projectRoot: root,
        projectWatch: rootAlreadyWatched
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
        shutdown(EXIT_DEGRADED, 'fail-on-degraded');
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
    // `settled` checks here cover only a cycle that outlived the handle.
    session.onCycleSettled = (cause) => {
      if (settled) return; // cycle outlived shutdown (inc 06 review S2)
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
        err(
          `watch cycle publication rejected — keeping last-good artifacts in ${outDir}: ${String(error)}`
        );
        return;
      }
      lastPublishedKey = key;
      publications += 1;
      err(
        `watch republished components=${outcome.componentCount} files=${outcome.fileCount} outDir=${outDir}`
      );
      reportDegradation();
    };

    const claim = startTurbopackWatcher(session, root);
    if (claim.kind === 'started') {
      watcher = claim.handle;
      // A dead watcher produces no further cycles, so the per-publication
      // degradation report would never run again — report (and trip
      // --fail-on-degraded) at the moment of death instead.
      watcher.onDied = () => {
        if (!settled) reportDegradation();
      };
    } else {
      // Reported as itself: a duplicate claim leaves this session unwired
      // exactly like a platform failure does, but restarting cannot fix it.
      rootAlreadyWatched = claim.kind === 'already-watched';
    }

    // Startup degradation report precedes readiness so an orchestrator
    // waiting on `watch ready` has already seen every unwatched root.
    if (reportDegradation()) return;

    // D5: readiness is an explicit observable event distinct from idle —
    // exactly one structured stderr line, emitted only after the first
    // complete, consistent publication (which happened above).
    err(
      `watch ready components=${firstPublication.componentCount} files=${firstPublication.fileCount} outDir=${outDir}`
    );
  });
}
