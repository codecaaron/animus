/**
 * Coalesces bursts of system-dependency events into single geological
 * resets: a quiescence window before starting, at most one reset in
 * flight, and exactly one follow-up when requests arrive mid-reset. A
 * package build regenerating its dist fires one reset, not one per file.
 *
 * Timer functions are injected seams — `vi.mock` on node builtins silently
 * no-ops under vite-plus-test, so tests drive a manual scheduler instead.
 */
type ResetTimerHandle = ReturnType<typeof setTimeout> | number;

type ResetErrorHandler = <Thrown>(error: Thrown) => void;

export class ResetCoalescer {
  private timer: ResetTimerHandle | null = null;
  private running = false;
  private dirty = false;

  constructor(
    private readonly run: () => void | Promise<void>,
    // Required: the timer callback is a bare scheduler entry point — a
    // throw escaping it (e.g. a strict-mode gate inside the reset) is an
    // unhandled exception that kills the dev server, so every caller must
    // decide where contained errors go.
    private readonly onError: ResetErrorHandler,
    private readonly quietMs = 60,
    private readonly schedule: (
      fn: () => void,
      ms: number
    ) => ResetTimerHandle = (fn, ms) => setTimeout(fn, ms),
    private readonly cancel: (timer: ResetTimerHandle) => void = (timer) =>
      clearTimeout(timer)
  ) {}

  /** Ask for a reset; bursts within the quiescence window collapse. */
  request(): void {
    if (this.running) {
      this.dirty = true;
      return;
    }
    if (this.timer !== null) this.cancel(this.timer);
    this.timer = this.schedule(async () => {
      this.timer = null;
      this.running = true;
      try {
        const result = this.run();
        if (result instanceof Promise) await result;
      } catch (err) {
        this.onError(err);
      } finally {
        this.running = false;
        if (this.dirty) {
          this.dirty = false;
          this.request();
        }
      }
    }, this.quietMs);
  }
}
