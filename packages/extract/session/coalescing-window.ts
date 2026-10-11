/**
 * The one coalescing window (SA19). It opens on the first pending event and
 * fires a fixed interval later: a later event joins the open window and never
 * pushes it back, so a steady stream of edits cannot starve the work it
 * coalesces. Builds, startup and explicit flushes bypass it through `flush`.
 * Hosts add no timers of their own.
 */
export const COALESCING_WINDOW_MS = 75;

export type WindowTimer = ReturnType<typeof setTimeout> | number;

/** The timer seam: tests drive a manual clock, since `vi.mock` on node
 *  builtins silently no-ops under vite-plus-test. */
export interface WindowClock {
  schedule(fn: () => void | Promise<void>, ms: number): WindowTimer;
  cancel(timer: WindowTimer): void;
}

const SYSTEM_CLOCK: WindowClock = {
  schedule: (fn, ms) => {
    const timer = setTimeout(fn, ms);
    // A pending window never holds the process open.
    timer.unref?.();
    return timer;
  },
  cancel: (timer) => clearTimeout(timer),
};

export class CoalescingWindow {
  private timer: WindowTimer | null = null;

  constructor(
    /** A returned promise is the window's work; the clock hands it to its
     *  caller and nothing awaits it in production. */
    private readonly fire: () => void | Promise<void>,
    private readonly windowMs = COALESCING_WINDOW_MS,
    private readonly clock: WindowClock = SYSTEM_CLOCK
  ) {}

  /** A pending event: opens the window, or joins the open one. */
  note(): void {
    if (this.timer !== null) return;
    this.timer = this.clock.schedule(() => {
      this.timer = null;
      return this.fire();
    }, this.windowMs);
  }

  /** Fires now, closing any open window: the bypass. */
  flush(): void | Promise<void> {
    this.cancel();
    return this.fire();
  }

  /** Closes an open window without firing it. */
  cancel(): void {
    if (this.timer === null) return;
    this.clock.cancel(this.timer);
    this.timer = null;
  }
}
