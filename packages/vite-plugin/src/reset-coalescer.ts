/**
 * Timer functions are injected seams: `vi.mock` on node builtins silently
 * no-ops under vite-plus-test, so tests drive a manual scheduler.
 */
type ResetTimerHandle = ReturnType<typeof setTimeout> | number;

type ResetErrorHandler = <Thrown>(error: Thrown) => void;

export class ResetCoalescer {
  private timer: ResetTimerHandle | null = null;
  private running = false;
  private dirty = false;

  constructor(
    private readonly run: () => void | Promise<void>,
    // Required: a throw escaping the timer callback is an unhandled
    // exception that kills the dev server, so every caller decides its fate.
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
