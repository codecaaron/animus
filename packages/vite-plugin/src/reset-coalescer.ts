import {
  COALESCING_WINDOW_MS,
  CoalescingWindow,
} from '@animus-ui/extract/session';

import type { WindowClock } from '@animus-ui/extract/session';

type ResetErrorHandler = <Thrown>(error: Thrown) => void;

/** Single-flight system resets on the session's one coalescing window: a
 *  request during a running reset schedules exactly one follow-up. */
export class ResetCoalescer {
  private running = false;
  private dirty = false;
  private readonly window: CoalescingWindow;

  constructor(
    private readonly run: () => void | Promise<void>,
    // Required: a throw escaping the timer callback is an unhandled
    // exception that kills the dev server, so every caller decides its fate.
    private readonly onError: ResetErrorHandler,
    windowMs = COALESCING_WINDOW_MS,
    clock?: WindowClock
  ) {
    this.window = new CoalescingWindow(() => this.runReset(), windowMs, clock);
  }

  /** Ask for a reset; requests within the open window collapse. */
  request(): void {
    if (this.running) {
      this.dirty = true;
      return;
    }
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
      if (this.dirty) {
        this.dirty = false;
        this.request();
      }
    }
  }
}
