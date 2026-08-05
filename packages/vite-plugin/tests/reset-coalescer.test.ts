import { describe, expect, it } from 'vitest';

import { PluginContext } from '../src/context';
import { ResetCoalescer } from '../src/reset-coalescer';

/** Manual timer harness — injected seams, no builtin mocking. */
function harness(run: () => void, quietMs = 60) {
  const pending: Array<{ id: number; fn: () => void }> = [];
  const errors: unknown[] = [];
  let nextId = 1;
  const coalescer = new ResetCoalescer(
    run,
    (err) => errors.push(err),
    quietMs,
    (fn) => {
      const id = nextId++;
      pending.push({ id, fn });
      return id;
    },
    (id) => {
      const at = pending.findIndex((t) => t.id === id);
      if (at !== -1) pending.splice(at, 1);
    }
  );
  const fire = () => {
    const timer = pending.shift();
    timer?.fn();
  };
  return { coalescer, pending, errors, fire };
}

describe('ResetCoalescer', () => {
  it('collapses a burst of requests into one scheduled reset', () => {
    let runs = 0;
    const { coalescer, pending, fire } = harness(() => runs++);

    for (let i = 0; i < 10; i++) coalescer.request();
    // Each request cancels the previous timer — exactly one remains.
    expect(pending.length).toBe(1);

    fire();
    expect(runs).toBe(1);
    expect(pending.length).toBe(0);
  });

  it('runs exactly one follow-up for requests during a running reset', () => {
    let runs = 0;
    const harnessRef: { fire?: () => void; coalescer?: ResetCoalescer } = {};
    const h = harness(() => {
      runs++;
      if (runs === 1) {
        // Three events arrive while the reset is executing.
        harnessRef.coalescer!.request();
        harnessRef.coalescer!.request();
        harnessRef.coalescer!.request();
      }
    });
    harnessRef.coalescer = h.coalescer;

    h.coalescer.request();
    h.fire();
    expect(runs).toBe(1);
    // The mid-reset requests coalesced into one scheduled follow-up.
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
    // The schedule callback runs on a bare timer in production — anything
    // escaping it is an unhandled exception that kills the dev server.
    expect(() => fire()).not.toThrow();
    expect(errors).toEqual([boom]);
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

  it('schedules again after a completed quiet cycle', () => {
    let runs = 0;
    const { coalescer, fire } = harness(() => runs++);

    coalescer.request();
    fire();
    coalescer.request();
    fire();
    expect(runs).toBe(2);
  });
});

describe('PluginContext geological-reset error wiring', () => {
  it('a strict reset failure surfaces as warn + overlay, not a process kill', async () => {
    const ctx = new PluginContext({ system: './src/ds.ts', strict: true });
    const warnings: string[] = [];
    ctx.logger = {
      warn: (message: string) => warnings.push(message),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const sent: Array<Record<string, unknown>> = [];
    ctx.devServer = {
      hot: { send: (p: Record<string, unknown>) => sent.push(p) },
    };
    ctx.performGeologicalReset = () => {
      throw new Error(
        '[animus-extract] unresolvable asset() specifier: @acme/typo.woff2'
      );
    };

    ctx.requestGeologicalReset('test');
    await new Promise((resolve) => setTimeout(resolve, 120));

    expect(warnings.some((w) => w.includes('geological reset failed'))).toBe(
      true
    );
    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe('error');
    expect((sent[0].err as { message: string }).message).toContain(
      '@acme/typo.woff2'
    );
  });
});
