import { describe, expect, it } from 'vitest';

import { asRuleId, stableHash } from '../src/core/identity';
import { eq, TRUE } from '../src/core/predicate';
import { createInMemoryHost } from '../src/providers/in-memory';
import { ANIMUS_LAYER_ORDER } from '../src/providers/style-universe';

import type { ComponentRecord } from '../src/providers/identity';
import type { InMemoryHostConfig } from '../src/providers/in-memory';

const alert: ComponentRecord = {
  id: 'src/Alert.tsx::Alert',
  file: 'src/Alert.tsx',
  binding: 'Alert',
  className: 'animus-Alert-a385f997',
  terminal: 'asElement',
  tag: 'div',
};

const badge: ComponentRecord = {
  id: 'src/Badge.tsx::Badge',
  file: 'src/Badge.tsx',
  binding: 'Badge',
  className: 'animus-Badge-b1',
  terminal: 'asElement',
};

const config = (): InMemoryHostConfig => ({
  rules: [
    {
      selector: {
        raw: '.animus-Alert-a385f997',
        classNames: ['animus-Alert-a385f997'],
      },
      declarations: [{ property: 'padding', value: '12px' }],
      condition: TRUE,
      layer: 'anm-base',
      order: 0,
      source: { file: 'src/Alert.tsx', span: [67, 200] },
      origin: { component: 'Alert', method: 'styles' },
    },
    {
      id: 'explicit-rule',
      selector: {
        raw: '.animus-Alert-a385f997--variant-outline',
        classNames: ['animus-Alert-a385f997--variant-outline'],
      },
      declarations: [{ property: 'border-width', value: '1px' }],
      condition: eq('variant:Alert:variant', 'outline'),
      layer: 'anm-variants',
      order: 0,
      source: { file: 'src/Alert.tsx' },
    },
  ],
  components: [alert, badge],
  dimensions: {
    mode: { kind: 'finite', values: ['light', 'dark'] },
    'viewport.inline': { kind: 'interval', min: 0, max: 1920 },
    'variant:Alert:variant': { kind: 'finite', values: ['filled', 'outline'] },
    'state:Alert:disabled': { kind: 'finite', values: [true, false] },
    'variant:Badge:tone': { kind: 'finite', values: ['neutral'] },
  },
  cuts: { 'viewport.inline': [768] },
  namedScenarios: { 'compact.dark': { mode: 'dark', 'viewport.inline': 375 } },
  ruleDependencies: { 'explicit-rule': ['src/Alert.tsx', 'src/theme.ts'] },
});

describe('createInMemoryHost — style universe', () => {
  it('defaults rule ids to the content hash and keeps explicit ids', () => {
    const host = createInMemoryHost(config());
    const [derived, explicit] = host.universe.universe().rules;

    const { id: _omitted, ...content } = config().rules[0];
    expect(derived.id).toBe(stableHash(content));
    expect(explicit.id).toBe('explicit-rule');
    expect(host.universe.universe().ruleById(explicit.id)).toBe(explicit);
    expect(host.universe.universe().ruleById(asRuleId('nope'))).toBeUndefined();
  });

  it('defaults to the animus layer order and an empty exclusion list', () => {
    const host = createInMemoryHost(config());
    expect(host.universe.universe().layerOrder).toEqual(ANIMUS_LAYER_ORDER);
    expect(host.universe.universe().exclusions).toEqual([]);
    expect(
      createInMemoryHost({
        ...config(),
        layerOrder: ['only'],
      }).universe.universe().layerOrder
    ).toEqual(['only']);
  });

  it('derives a deterministic synthetic program revision', () => {
    const first = createInMemoryHost(config()).program;
    const second = createInMemoryHost(config()).program;

    expect(first).toEqual(second);
    expect(first.kind).toBe('synthetic');
    expect(first.hash).toMatch(/^[0-9a-f]{16}$/);
    expect(first.label).toBeUndefined();

    const pinned = createInMemoryHost({
      ...config(),
      program: { kind: 'analysis-artifacts', hash: 'abc', label: 'HEAD' },
    }).program;
    expect(pinned).toEqual({
      kind: 'analysis-artifacts',
      hash: 'abc',
      label: 'HEAD',
    });
  });
});

describe('createInMemoryHost — scenarios', () => {
  it('passes the declared dimensions, cuts and named scenarios through', () => {
    const host = createInMemoryHost(config());
    expect(Object.keys(host.scenarios.dimensions()).sort()).toEqual([
      'mode',
      'state:Alert:disabled',
      'variant:Alert:variant',
      'variant:Badge:tone',
      'viewport.inline',
    ]);
    expect(host.scenarios.cuts()).toEqual({ 'viewport.inline': [768] });
    expect(host.scenarios.namedScenarios()['compact.dark']).toEqual({
      mode: 'dark',
      'viewport.inline': 375,
    });
  });

  it('defaults every scenario surface to empty', () => {
    const host = createInMemoryHost({ rules: [], components: [] });
    expect(host.scenarios.dimensions()).toEqual({});
    expect(host.scenarios.cuts()).toEqual({});
    expect(host.scenarios.namedScenarios()).toEqual({});
  });
});

describe('createInMemoryHost — identity', () => {
  it('resolves a target by component id and by bare binding', () => {
    const host = createInMemoryHost(config());
    const byId = host.identity.resolveTarget('src/Alert.tsx::Alert');
    const byBinding = host.identity.resolveTarget('Alert');

    expect(byId?.target).toBe('src/Alert.tsx::Alert');
    expect(byBinding?.component).toEqual(alert);
    expect(host.identity.componentById(alert.id)).toEqual(alert);
    expect(host.identity.componentById('missing')).toBeUndefined();
    expect(host.identity.resolveTarget('Missing')).toBeUndefined();
  });

  it('refuses an ambiguous bare binding rather than picking a winner', () => {
    const twin: ComponentRecord = { ...alert, id: 'src/Other.tsx::Alert' };
    const host = createInMemoryHost({
      ...config(),
      components: [alert, twin],
    });

    expect(host.identity.resolveTarget('Alert')).toBeUndefined();
    expect(host.identity.resolveTarget('src/Other.tsx::Alert')?.component).toBe(
      twin
    );
  });

  it('scopes a target to its own axes plus the unscoped ones', () => {
    const host = createInMemoryHost(config());
    const resolved = host.identity.resolveTarget('Alert');

    expect(Object.keys(resolved?.dimensions ?? {}).sort()).toEqual([
      'mode',
      'state:Alert:disabled',
      'variant:Alert:variant',
      'viewport.inline',
    ]);
  });

  it('honours an explicit per-target domain', () => {
    const host = createInMemoryHost({
      ...config(),
      targetDimensions: {
        'src/Alert.tsx::Alert': { mode: { kind: 'finite', values: ['dark'] } },
      },
    });
    expect(host.identity.resolveTarget('Alert')?.dimensions).toEqual({
      mode: { kind: 'finite', values: ['dark'] },
    });
  });
});

describe('createInMemoryHost — default class emission', () => {
  const classesAt = (point: Record<string, string | number | boolean>) =>
    createInMemoryHost(config())
      .identity.resolveTarget('Alert')
      ?.classes(point);

  it('emits the component class, then variants, then active states', () => {
    expect(
      classesAt({
        mode: 'dark',
        'variant:Alert:variant': 'outline',
        'state:Alert:disabled': true,
      })
    ).toEqual([
      'animus-Alert-a385f997',
      'animus-Alert-a385f997--variant-outline',
      'animus-Alert-a385f997--disabled',
    ]);
  });

  it('omits inactive states and ignores other components’ axes', () => {
    expect(
      classesAt({
        'state:Alert:disabled': false,
        'variant:Badge:tone': 'neutral',
        'viewport.inline': 375,
      })
    ).toEqual(['animus-Alert-a385f997']);
  });

  it('is stable under key order', () => {
    const point = {
      'state:Alert:disabled': true,
      'variant:Alert:variant': 'filled',
    };
    const reversed = {
      'variant:Alert:variant': 'filled',
      'state:Alert:disabled': true,
    };
    expect(classesAt(point)).toEqual(classesAt(reversed));
  });

  it('defers to an injected classesFor', () => {
    const host = createInMemoryHost({
      ...config(),
      classesFor: (component) => [`custom-${component.binding}`],
    });
    expect(host.identity.resolveTarget('Alert')?.classes({})).toEqual([
      'custom-Alert',
    ]);
  });
});

describe('createInMemoryHost — dependencies', () => {
  it('reports the declared dependencies of a rule', () => {
    const host = createInMemoryHost(config());
    expect(
      host.dependencies.dependenciesOfRule(asRuleId('explicit-rule'))
    ).toEqual(['src/Alert.tsx', 'src/theme.ts']);
    expect(host.dependencies.dependenciesOfRule(asRuleId('nope'))).toEqual([]);
  });

  it('maps a source file back to every rule that rests on it', () => {
    const host = createInMemoryHost(config());
    expect(host.dependencies.rulesOfSource('src/Alert.tsx')).toHaveLength(2);
    expect(host.dependencies.rulesOfSource('src/theme.ts')).toEqual([
      'explicit-rule',
    ]);
    expect(host.dependencies.rulesOfSource('src/nothing.ts')).toEqual([]);
  });
});
