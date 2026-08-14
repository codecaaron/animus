import { describe, expect, it } from 'vitest';

import { asRuleId } from '../src/core/identity';
import {
  applyDeltas,
  describeDelta,
  MODEL_VERSION,
  worldId,
} from '../src/core/world';

import type { RenderWorld, WorldDelta } from '../src/core/world';

const base: RenderWorld = {
  program: { kind: 'synthetic', hash: 'p1' },
  modelVersion: MODEL_VERSION,
  scenario: {
    mode: { kind: 'finite', values: ['light', 'dark'] },
    'viewport.inline': { kind: 'interval', min: 0, max: 1920 },
  },
  environment: {
    name: 'chromium-stable',
    assumptions: { rootFontSize: '16px' },
  },
  interventions: [],
  evidenceRevision: 'e0',
};

describe('worldId', () => {
  it('is content equality, not object identity', () => {
    const reordered: RenderWorld = {
      evidenceRevision: 'e0',
      interventions: [],
      environment: {
        assumptions: { rootFontSize: '16px' },
        name: 'chromium-stable',
      },
      scenario: {
        'viewport.inline': { kind: 'interval', min: 0, max: 1920 },
        mode: { kind: 'finite', values: ['light', 'dark'] },
      },
      modelVersion: MODEL_VERSION,
      program: { hash: 'p1', kind: 'synthetic' },
    };
    expect(worldId(reordered)).toBe(worldId(base));
  });

  it('moves when any component of the world moves', () => {
    expect(worldId({ ...base, evidenceRevision: 'e1' })).not.toBe(
      worldId(base)
    );
    expect(
      worldId({ ...base, program: { kind: 'synthetic', hash: 'p2' } })
    ).not.toBe(worldId(base));
    expect(
      worldId({
        ...base,
        environment: { name: 'chromium-stable', assumptions: {} },
      })
    ).not.toBe(worldId(base));
  });
});

describe('applyDeltas', () => {
  const removal: WorldDelta = {
    kind: 'remove-declaration',
    rule: asRuleId('r1'),
    property: 'padding',
  };

  it('records every delta and changes the world identity', () => {
    const next = applyDeltas(base, [removal]);
    expect(next.interventions).toEqual([removal]);
    expect(worldId(next)).not.toBe(worldId(base));
  });

  it('leaves the input world untouched', () => {
    applyDeltas(base, [removal]);
    expect(base.interventions).toEqual([]);
    expect(worldId(base)).toBe(worldId({ ...base }));
  });

  it('appends across successive applications', () => {
    const once = applyDeltas(base, [removal]);
    const twice = applyDeltas(once, [
      { kind: 'assume', assumption: 'no runtime style writes' },
    ]);
    expect(twice.interventions).toHaveLength(2);
    expect(twice.interventions[0]).toEqual(removal);
  });

  it('narrows a dimension for force-dimension', () => {
    const next = applyDeltas(base, [
      { kind: 'force-dimension', dimension: 'mode', value: 'dark' },
    ]);
    expect(next.scenario.mode).toEqual({ kind: 'finite', values: ['dark'] });
    expect(next.scenario['viewport.inline']).toEqual(
      base.scenario['viewport.inline']
    );
    expect(next.interventions).toHaveLength(1);
  });

  it('replaces a domain for pin-dimension-domain', () => {
    const next = applyDeltas(base, [
      {
        kind: 'pin-dimension-domain',
        dimension: 'viewport.inline',
        domain: { kind: 'interval', min: 320, max: 768 },
      },
    ]);
    expect(next.scenario['viewport.inline']).toEqual({
      kind: 'interval',
      min: 320,
      max: 768,
    });
  });

  it('rides other delta kinds along without touching the scenario', () => {
    const next = applyDeltas(base, [
      { kind: 'replace-token', token: 'space.4', value: '8px' },
    ]);
    expect(next.scenario).toEqual(base.scenario);
    expect(next.interventions).toHaveLength(1);
  });
});

describe('describeDelta', () => {
  it('renders each kind', () => {
    expect(
      describeDelta({
        kind: 'remove-declaration',
        rule: asRuleId('r1'),
        property: 'padding',
      })
    ).toBe('remove padding from rule r1');
    expect(
      describeDelta({
        kind: 'replace-declaration',
        rule: asRuleId('r1'),
        property: 'padding',
        value: '8px',
      })
    ).toBe('set padding to 8px in rule r1');
    expect(
      describeDelta({
        kind: 'add-declaration',
        rule: asRuleId('r1'),
        property: 'gap',
        value: '4px',
      })
    ).toBe('add gap: 4px to rule r1');
    expect(
      describeDelta({ kind: 'replace-token', token: 'space.4', value: '8px' })
    ).toBe('replace token space.4 with 8px');
    expect(
      describeDelta({
        kind: 'force-dimension',
        dimension: 'mode',
        value: 'dark',
      })
    ).toBe('force mode = dark');
    expect(
      describeDelta({
        kind: 'pin-dimension-domain',
        dimension: 'mode',
        domain: { kind: 'finite', values: ['dark'] },
      })
    ).toBe('pin mode to {dark}');
    expect(
      describeDelta({
        kind: 'pin-dimension-domain',
        dimension: 'viewport.inline',
        domain: { kind: 'interval', min: 0, max: 768 },
      })
    ).toBe('pin viewport.inline to [0, 768]');
    expect(
      describeDelta({ kind: 'assume', assumption: 'no runtime writes' })
    ).toBe('assume no runtime writes');
    expect(
      describeDelta({
        kind: 'assume',
        assumption: 'no runtime writes',
        note: 'declared by the host',
      })
    ).toBe('assume no runtime writes (declared by the host)');
  });
});
