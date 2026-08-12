import { describe, expect, it } from 'vitest';

import { asDependencyId, asTargetId } from '../src/core/identity';
import { ObligationRegistry } from '../src/core/obligation';
import { eq } from '../src/core/predicate';

import type { RenderSubject } from '../src/core/fact';
import type { UnknownObligation } from '../src/core/obligation';

const target = asTargetId('src/Alert.tsx::Alert');
const subject: RenderSubject = { kind: 'style-target', target };
const other: RenderSubject = { kind: 'component', component: 'Badge' };

const geometry = (
  scope: readonly RenderSubject[]
): Omit<UnknownObligation, 'id'> => ({
  origin: { file: 'src/Alert.tsx', span: [54, 899] },
  guard: eq('mode', 'dark'),
  effectClass: 'intrinsic-inline-size',
  influenceScope: scope,
  reason: 'intrinsic sizing is not derivable from the closed style universe',
  dischargeOptions: [
    {
      kind: 'context-capsule-measurement',
      description: 'measure the node in an isolated capsule',
      automated: false,
    },
  ],
  dependencies: [asDependencyId('src/Alert.tsx')],
});

describe('ObligationRegistry', () => {
  it('is content-addressed: the same gap found twice is one obligation', () => {
    const registry = new ObligationRegistry();
    const first = registry.register(geometry([subject]));
    const second = registry.register(geometry([subject]));

    expect(second).toBe(first);
    expect(registry.all()).toHaveLength(1);
    expect(registry.get(first.id)).toBe(first);
  });

  it('separates obligations that differ in content', () => {
    const registry = new ObligationRegistry();
    const base = registry.register(geometry([subject]));
    const bounded = registry.register({
      ...geometry([subject]),
      currentBound: { kind: 'interval', min: 0, max: 640, unit: 'px' },
    });

    expect(bounded.id).not.toBe(base.id);
    expect(registry.all()).toHaveLength(2);
  });

  it('finds obligations by any subject in their influence scope', () => {
    const registry = new ObligationRegistry();
    const wide = registry.register(geometry([subject, other]));
    registry.register({ ...geometry([other]), reason: 'other subject only' });

    expect(registry.forSubject(subject).map((o) => o.id)).toEqual([wide.id]);
    expect(registry.forSubject(other)).toHaveLength(2);
    expect(registry.forSubject({ kind: 'world' })).toEqual([]);
  });
});
