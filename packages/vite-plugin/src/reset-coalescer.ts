import {
  COALESCING_WINDOW_MS,
  CoalescingWindow,
} from '@animus-ui/extract/session';

import type { WindowClock } from '@animus-ui/extract/session';

type ResetErrorHandler = <Thrown>(error: Thrown) => void;

/** Single-flight system resets on the session's one coalescing window: a
 *  request during a running reset schedules exactly one follow-up, due a
 *  fixed interval after its own first request. */
export class ResetCoalescer {
  private running = false;
  /** The window came due while a reset ran: the follow-up runs as that
   *  reset settles. */
  private due = false;
  private readonly window: CoalescingWindow;

  constructor(
    private readonly run: () => void | Promise<void>,
    // Required: a throw escaping the timer callback is an unhandled
    // exception that kills the dev server, so every caller decides its fate.
    private readonly onError: ResetErrorHandler,
    windowMs = COALESCING_WINDOW_MS,
    clock?: WindowClock
  ) {
    this.window = new CoalescingWindow(
      () => {
        if (!this.running) return this.runReset();
        this.due = true;
      },
      windowMs,
      clock
    );
  }

  /** Ask for a reset; requests within the open window collapse. A request
   *  during a running reset opens the follow-up's window now, so its
   *  deadline counts from that request, not from the settlement. */
  request(): void {
    this.window.note();
  }

  private async runReset(): Promise<void> {
    this.running = true;
    try {
      const result = this.run();
      if (result instanceof Promise) await result;
    } catch (err) {
      this.onError(err);
    } finally {
      this.running = false;
      if (this.due) {
        this.due = false;
        void this.runReset();
      }
    }
  }
}
