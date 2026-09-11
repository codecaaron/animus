/** Listeners run on the event loop, so a handler never lands inside the
 *  writer's synchronous swap; with none the kernel kills mid-publish. */

/** Signal exit conventions (128 + signal number). */
export const EXIT_SIGINT = 130;
export const EXIT_SIGTERM = 143;

const SHUTDOWN_SIGNALS = [
  ['SIGINT', EXIT_SIGINT],
  ['SIGTERM', EXIT_SIGTERM],
] as const;

type ShutdownStage = 'armed' | 'draining' | 'released';

/** `abandoned` means a second signal cut an unfinished drain short. */
export interface ShutdownOutcome {
  exitCode: number;
  signal: string;
  abandoned: boolean;
}

export interface ShutdownHandlers {
  /** Called once. An abandoned outcome must give up the SAME claims as a
   *  drained one, or `lock.json` outlives the process. */
  release: (outcome: ShutdownOutcome) => void;
  /** Bounded work that must finish before the claim is given up; a second
   *  signal during it abandons the drain and exits at once. */
  drain?: (exitCode: number, signal: string) => Promise<void>;
}

/** Removal is mandatory on the normal path: `main()` is re-enterable in
 *  process, so a listener left behind accumulates one per call. */
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
