import { describe, expect, it } from 'vitest';

import { HotUpdateEvents } from '../src/hot-update-events';

/**
 * The once-per-event seam of the `hotUpdate` hook. Vite dispatches the hook
 * once per environment for a single file event (client first, then every
 * non-client environment), so the analysis half — cache mutation, engine
 * re-analysis, reset scheduling — must be claimed exactly once while every
 * environment still invalidates its own modules. The hook itself needs a
 * running dev server, so the claim/publish algebra is tested directly.
 */

const FILE = '/repo/src/Button.tsx';

describe('HotUpdateEvents', () => {
  it('gives the event to the client dispatch, not to the later ones', () => {
    const events = new HotUpdateEvents();

    expect(events.claim('client', FILE, 1)).toBe(true);
    expect(events.claim('ssr', FILE, 1)).toBe(false);
    expect(events.claim('rsc', FILE, 1)).toBe(false);
  });

  it('publishes the owner result to the environments that follow', () => {
    const events = new HotUpdateEvents();

    events.claim('client', FILE, 1);
    events.record(FILE, 1, {
      kind: 'analyzed',
      staleDefinitionFiles: ['src/Card.tsx'],
      systemPropsChanged: true,
      presentationOnly: false,
    });

    events.claim('ssr', FILE, 1);
    // The whole decision travels, including whether the served system-props
    // module moved: only the owning dispatch held the before/after values.
    expect(events.resultOf(FILE, 1)).toEqual({
      kind: 'analyzed',
      staleDefinitionFiles: ['src/Card.tsx'],
      systemPropsChanged: true,
      presentationOnly: false,
    });
  });

  it('gives the event to the first dispatch when there is no client', () => {
    // A plugin filtered out of the client environment never sees the client
    // dispatch — the first environment that does still owns the analysis.
    const events = new HotUpdateEvents();

    expect(events.claim('ssr', FILE, 1)).toBe(true);
    expect(events.claim('rsc', FILE, 1)).toBe(false);
  });

  it('always gives the client its own analysis, even on a repeated key', () => {
    // Two saves within the same millisecond produce the same (file,
    // timestamp) key; the client dispatch must never be starved by it.
    const events = new HotUpdateEvents();

    events.claim('client', FILE, 1);
    events.record(FILE, 1, {
      kind: 'analyzed',
      staleDefinitionFiles: [],
      systemPropsChanged: false,
      presentationOnly: false,
    });

    expect(events.claim('client', FILE, 1)).toBe(true);
    // Claiming resets the published result — the new event has not run yet.
    expect(events.resultOf(FILE, 1)).toEqual({ kind: 'ignored' });
  });

  it('keeps interleaved events apart', () => {
    // Vite does not serialize watcher handlers, so a second file event can
    // reach the client while the first is still walking its environments.
    const events = new HotUpdateEvents();
    const other = '/repo/src/Card.tsx';

    events.claim('client', FILE, 1);
    events.record(FILE, 1, { kind: 'unchanged' });
    events.claim('client', other, 2);
    events.record(other, 2, {
      kind: 'analyzed',
      staleDefinitionFiles: [],
      systemPropsChanged: false,
      presentationOnly: false,
    });

    expect(events.claim('ssr', FILE, 1)).toBe(false);
    expect(events.resultOf(FILE, 1)).toEqual({ kind: 'unchanged' });
    expect(events.claim('ssr', other, 2)).toBe(false);
    expect(events.resultOf(other, 2)).toEqual({
      kind: 'analyzed',
      staleDefinitionFiles: [],
      systemPropsChanged: false,
      presentationOnly: false,
    });
  });

  it('reports an event nobody ever claimed as ignored', () => {
    const events = new HotUpdateEvents(2);

    expect(events.resultOf(FILE, 99)).toEqual({ kind: 'ignored' });
  });

  it('reports an evicted decision as evicted, not as ignored', () => {
    // History is bounded, and `ignored` is the LEAST conservative kind —
    // "out of extraction scope, leave it to normal HMR". A decision that fell
    // out of the window is the opposite: the file WAS analyzed and every
    // environment still owes its own graph an invalidation.
    const events = new HotUpdateEvents(2);

    events.claim('client', FILE, 1);
    events.record(FILE, 1, { kind: 'unchanged' });
    events.claim('client', FILE, 2);
    events.claim('client', FILE, 3);

    expect(events.resultOf(FILE, 1)).toEqual({ kind: 'evicted' });
    expect(events.claim('ssr', FILE, 3)).toBe(false);
  });

  it('never re-claims an evicted event for a later environment', () => {
    // Re-claiming would re-run the whole analysis for an event the owner
    // already analyzed — and the content-hash gate would then report
    // `unchanged`, suppressing the update in that environment entirely.
    const events = new HotUpdateEvents(2);

    events.claim('client', FILE, 1);
    events.record(FILE, 1, {
      kind: 'analyzed',
      staleDefinitionFiles: [],
      systemPropsChanged: false,
      presentationOnly: false,
    });
    events.claim('client', FILE, 2);
    events.claim('client', FILE, 3);

    expect(events.claim('ssr', FILE, 1)).toBe(false);
    expect(events.resultOf(FILE, 1)).toEqual({ kind: 'evicted' });
  });

  it('lets the client re-own a key its own eviction retired', () => {
    const events = new HotUpdateEvents(2);

    events.claim('client', FILE, 1);
    events.record(FILE, 1, { kind: 'unchanged' });
    events.claim('client', FILE, 2);
    events.claim('client', FILE, 3);
    expect(events.resultOf(FILE, 1)).toEqual({ kind: 'evicted' });

    // The same (file, timestamp) reaching the client again is a new event,
    // not the evicted one: it claims and starts from a clean decision.
    expect(events.claim('client', FILE, 1)).toBe(true);
    expect(events.resultOf(FILE, 1)).toEqual({ kind: 'ignored' });
  });
});
