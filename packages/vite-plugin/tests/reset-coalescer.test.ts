import { createLogger } from 'vite';
import { describe, expect, it } from 'vitest';

import { PluginContext } from '../src/context';
import { ResetCoalescer } from '../src/reset-coalescer';

import type { ErrorPayload } from 'vite';

function harness(run: () => void | Promise<void>, windowMs = 75) {
  const pending: Array<{ id: number; fn: () => void | Promise<void> }> = [];
  const errors: unknown[] = [];
  let nextId = 1;
  const coalescer = new ResetCoalescer(
    run,
    (err) => errors.push(err),
    windowMs,
    {
      schedule: (fn) => {
        const id = nextId++;
        pending.push({ id, fn });
        return id;
      },
      cancel: (id) => {
        const at = pending.findIndex((t) => t.id === id);
        if (at !== -1) pending.splice(at, 1);
      },
    }
  );
  const fire = () => {
    const timer = pending.shift();
    return timer?.fn();
  };
  return { coalescer, pending, errors, fire };
}

describe('ResetCoalescer', () => {
  it('collapses a burst of requests into one scheduled reset', () => {
    let runs = 0;
    const { coalescer, pending, fire } = harness(() => {
      runs++;
    });

    for (let i = 0; i < 10; i++) coalescer.request();
    expect(pending.length).toBe(1);

    fire();
    expect(runs).toBe(1);
    expect(pending.length).toBe(0);
  });

  it('runs exactly one follow-up for requests during a running reset', () => {
    let runs = 0;
    const h = harness(() => {
      runs++;
      if (runs === 1) {
        h.coalescer.request();
        h.coalescer.request();
        h.coalescer.request();
      }
    });

    h.coalescer.request();
    h.fire();
    expect(runs).toBe(1);
    expect(h.pending.length).toBe(1);
    h.fire();
    expect(runs).toBe(2);
    expect(h.pending.length).toBe(0);
  });

  it('contains a throwing run: routed to onError, never propagates', () => {
    const boom = new Error('strict gate');
    const { coalescer, errors, fire } = harness(() => {
      throw boom;
    });

    coalescer.request();
    // The schedule callback runs on a bare timer in production, so anything
    // escaping it is an unhandled exception that kills the dev server.
    expect(() => fire()).not.toThrow();
    expect(errors).toEqual([boom]);
  });

  it('contains a rejected async run and routes it to onError', async () => {
    const boom = new Error('async strict gate');
    const { coalescer, errors, fire } = harness(async () => {
      throw boom;
    });

    coalescer.request();
    await expect(fire()).resolves.toBeUndefined();
    expect(errors).toEqual([boom]);
  });

  it('runs one follow-up only after an async reset settles', async () => {
    let runs = 0;
    let releaseFirst!: () => void;
    const h = harness(() => {
      runs++;
      if (runs === 1) {
        return new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
      }
    });

    h.coalescer.request();
    const firstRun = h.fire();
    expect(runs).toBe(1);

    // Requests during the run open one window; it comes due mid-run and
    // never overlaps the running reset.
    h.coalescer.request();
    h.coalescer.request();
    h.coalescer.request();
    expect(h.pending).toHaveLength(1);
    h.fire();
    expect(runs).toBe(1);

    releaseFirst();
    await firstRun;
    expect(runs).toBe(2);
    expect(h.pending).toHaveLength(0);
  });

  it('recovers after a throwing run: later requests still reset', () => {
    let runs = 0;
    const { coalescer, errors, fire } = harness(() => {
      runs++;
      if (runs === 1) throw new Error('transient');
    });

    coalescer.request();
    fire();
    coalescer.request();
    fire();

    expect(runs).toBe(2);
    expect(errors).toHaveLength(1);
  });

  it('a throwing run still honors the mid-run follow-up', () => {
    let runs = 0;
    const h = harness(() => {
      runs++;
      if (runs === 1) {
        h.coalescer.request();
        throw new Error('transient');
      }
    });

    h.coalescer.request();
    h.fire();
    expect(h.pending.length).toBe(1);
    h.fire();
    expect(runs).toBe(2);
  });

  it('schedules again after a completed window', () => {
    let runs = 0;
    const { coalescer, fire } = harness(() => {
      runs++;
    });

    coalescer.request();
    fire();
    coalescer.request();
    fire();
    expect(runs).toBe(2);
  });
});

/** A manual clock with time: timers fire in due order as it advances. */
function timedClock() {
  let now = 0;
  let nextId = 1;
  const timers: Array<{
    id: number;
    due: number;
    fn: () => void | Promise<void>;
  }> = [];
  return {
    clock: {
      schedule: (fn: () => void | Promise<void>, ms: number) => {
        const id = nextId++;
        timers.push({ id, due: now + ms, fn });
        return id;
      },
      cancel: (id: number | ReturnType<typeof setTimeout>) => {
        const at = timers.findIndex((t) => t.id === id);
        if (at !== -1) timers.splice(at, 1);
      },
    },
    now: () => now,
    /** Advances to `to`, firing each timer due by then at its due time. */
    async advance(to: number) {
      for (;;) {
        timers.sort((a, b) => a.due - b.due);
        const next = timers[0];
        if (next === undefined || next.due > to) break;
        timers.shift();
        now = next.due;
        // A held reset never settles here: fire it and let it start.
        void next.fn();
        await new Promise((resolve) => setImmediate(resolve));
      }
      now = to;
    },
  };
}

describe('ResetCoalescer window', () => {
  /** Contract: the window never moves back (SA19). It fires a fixed
   *  interval after its first event, and a follow-up requested during a
   *  running reset is due a fixed interval after its own first request. */
  it('the window never moves back', async () => {
    const time = timedClock();
    const starts: number[] = [];
    let finish!: () => void;
    const coalescer = new ResetCoalescer(
      () => {
        starts.push(time.now());
        if (starts.length > 1) return;
        return new Promise<void>((resolve) => {
          finish = resolve;
        });
      },
      () => {},
      75,
      time.clock
    );

    // Requests at 0, 50 and 70: the first reset starts at 75 regardless.
    coalescer.request();
    await time.advance(50);
    coalescer.request();
    await time.advance(70);
    coalescer.request();
    await time.advance(75);
    expect(starts).toEqual([75]);

    // Requests at 80, 200 and 290 during the running reset: the first is
    // due at 155, so the follow-up starts at settlement, 300, and covers
    // the later two; no second follow-up runs at 365.
    await time.advance(80);
    coalescer.request();
    await time.advance(200);
    coalescer.request();
    await time.advance(290);
    coalescer.request();
    await time.advance(300);
    finish();
    await new Promise((resolve) => setImmediate(resolve));
    await time.advance(400);
    expect(starts).toEqual([75, 300]);
  });
});

describe('PluginContext system-reload error wiring', () => {
  it('a strict reset failure surfaces as warn + overlay, not a process kill', async () => {
    const ctx = new PluginContext({ system: './src/ds.ts', strict: true });
    const warnings: string[] = [];
    ctx.logger = createLogger('silent');
    ctx.logger.warn = (message) => {
      warnings.push(message);
    };
    const sent: ErrorPayload[] = [];
    ctx.devServer = {
      hot: { send: (payload: ErrorPayload) => sent.push(payload) },
    };
    ctx.performSystemReload = () => {
      throw new Error(
        '[animus-extract] unresolvable asset() specifier: @acme/typo.woff2'
      );
    };

    ctx.requestSystemReload('test');
    await new Promise((resolve) => setTimeout(resolve, 120));

    expect(warnings.some((w) => w.includes('system reload failed'))).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe('error');
    expect(sent[0].err.message).toContain('@acme/typo.woff2');
  });
});
