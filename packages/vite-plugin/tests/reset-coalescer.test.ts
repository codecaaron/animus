import { describe, expect, it } from 'vitest';

import { ResetCoalescer } from '../src/reset-coalescer';

/** Manual timer harness — injected seams, no builtin mocking. */
function harness(run: () => void, quietMs = 60) {
  const pending: Array<{ id: number; fn: () => void }> = [];
  let nextId = 1;
  const coalescer = new ResetCoalescer(
    run,
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
  return { coalescer, pending, fire };
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
