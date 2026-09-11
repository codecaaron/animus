import { describe, expect, it } from 'vitest';

import { HotUpdateEvents } from '../src/hot-update-events';

/** Vite dispatches `hotUpdate` once per environment for one file event, so
 *  the analysis is claimed once while every environment still invalidates. */

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
    // Only the owning dispatch holds the before/after values it reports.
    expect(events.resultOf(FILE, 1)).toEqual({
      kind: 'analyzed',
      staleDefinitionFiles: ['src/Card.tsx'],
      systemPropsChanged: true,
      presentationOnly: false,
    });
  });

  it('gives the event to the first dispatch when there is no client', () => {
    // A plugin filtered out of the client environment never sees that
    // dispatch.
    const events = new HotUpdateEvents();

    expect(events.claim('ssr', FILE, 1)).toBe(true);
    expect(events.claim('rsc', FILE, 1)).toBe(false);
  });

  it('always gives the client its own analysis, even on a repeated key', () => {
    // Two saves in the same millisecond produce the same (file, timestamp) key.
    const events = new HotUpdateEvents();

    events.claim('client', FILE, 1);
    events.record(FILE, 1, {
      kind: 'analyzed',
      staleDefinitionFiles: [],
      systemPropsChanged: false,
      presentationOnly: false,
    });

    expect(events.claim('client', FILE, 1)).toBe(true);
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
    // `ignored` means out of extraction scope, while an evicted decision
    // means the file was analyzed and every graph still owes invalidation.
    const events = new HotUpdateEvents(2);

    events.claim('client', FILE, 1);
    events.record(FILE, 1, { kind: 'unchanged' });
    events.claim('client', FILE, 2);
    events.claim('client', FILE, 3);

    expect(events.resultOf(FILE, 1)).toEqual({ kind: 'evicted' });
    expect(events.claim('ssr', FILE, 3)).toBe(false);
  });

  it('never re-claims an evicted event for a later environment', () => {
    // Re-claiming re-runs an analysis the owner already did, and the
    // content-hash gate then reports `unchanged`, suppressing the update.
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

    expect(events.claim('client', FILE, 1)).toBe(true);
    expect(events.resultOf(FILE, 1)).toEqual({ kind: 'ignored' });
  });
});
