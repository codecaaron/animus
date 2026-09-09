/**
 * The CLI's only owner of SIGINT/SIGTERM registration, shared by `animus
 * watch` and `animus build`, so an interrupted run gives up its claim on the
 * output tree in exactly one way. Listeners run on the event loop, so a
 * handler can never land inside the writer's synchronous swap; with no
 * listener registered the kernel terminates the process wherever it is,
 * which for `build` is mid-publish, leaving the staging tree and the
 * advisory lock behind.
 */

/** Signal exit conventions (128 + signal number). */
export const EXIT_SIGINT = 130;
export const EXIT_SIGTERM = 143;

const SHUTDOWN_SIGNALS = [
  ['SIGINT', EXIT_SIGINT],
  ['SIGTERM', EXIT_SIGTERM],
] as const;

/** How far one process's shutdown has got. */
type ShutdownStage = 'armed' | 'draining' | 'released';

/** The ending a shutdown reached: the signal that caused it, and whether a
 *  second signal cut an unfinished `drain` short. */
export interface ShutdownOutcome {
  exitCode: number;
  signal: string;
  abandoned: boolean;
}

export interface ShutdownHandlers {
  /**
   * Give up what the run claimed and report the ending. Called once. An
   * `abandoned` outcome must give up the SAME claims as a drained one, or
   * `lock.json` outlives the process and the next run refuses a claim it
   * cannot prove dead.
   */
  release: (outcome: ShutdownOutcome) => void;
  /**
   * Bounded work that must finish before the claim is given up (the watch's
   * in-flight cycle). Listeners stay armed while it runs, so a second signal
   * abandons it, takes the release, and exits at once. Omit it for a
   * synchronous shutdown, which then has no escalation window.
   */
  drain?: (exitCode: number, signal: string) => Promise<void>;
}

/**
 * Register SIGINT/SIGTERM handling, returning the function that removes both
 * listeners. Removal is mandatory on the normal path: `main()` is a published
 * entry point, so a listener left behind accumulates one per in-process call.
 */
export function installShutdownSignals({
  release,
  drain,
}: ShutdownHandlers): () => void {
  let stage: ShutdownStage = 'armed';
  const registered = SHUTDOWN_SIGNALS.map(([signal, exitCode]) => {
    const listener = (): void => {
      if (stage === 'released') return;
      if (stage === 'draining') {
        stage = 'released';
        release({ exitCode, signal, abandoned: true });
        process.exit(exitCode);
      } else if (drain === undefined) {
        stage = 'released';
        release({ exitCode, signal, abandoned: false });
      } else {
        stage = 'draining';
        void (async () => {
          try {
            await drain(exitCode, signal);
          } catch {
            // A failed drain has already reported itself; the claim is given
            // up either way.
          }
          // A second signal already released and exited.
          if (stage !== 'draining') return;
          stage = 'released';
          release({ exitCode, signal, abandoned: false });
        })();
      }
    };
    process.on(signal, listener);
    return { signal, listener } as const;
  });
  return () => {
    for (const { signal, listener } of registered) {
      process.removeListener(signal, listener);
    }
  };
}
