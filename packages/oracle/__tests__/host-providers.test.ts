import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { AnimusAdapterError } from '../src/host/animus/errors';
import { createAnimusHost } from '../src/host/animus/host';
import { loadAnimusArtifacts } from '../src/host/animus/loader';

const FIXTURE = join(__dirname, 'fixtures/rollup-app');

const input = loadAnimusArtifacts(FIXTURE);
const host = createAnimusHost(input);

const TEST_DS = '../../packages/test-ds/src/components';
const ALERT_ID = `${TEST_DS}/Alert.tsx::Alert`;

describe('animus host — program identity', () => {
  it('moves the program hash when the stylesheet moves', () => {
    const stylesheetText = input.stylesheetText ?? '';
    // Vacuity guard: the edit below must actually land in the stylesheet.
    expect(stylesheetText).toContain('#ef4444');
    const recolored = createAnimusHost({
      ...input,
      stylesheetText: stylesheetText.replace('#ef4444', '#ee4444'),
    });

    // Same manifest, different token CSS → different exact facts, so the
    // program identity (and every world id built on it) must move too.
    expect(recolored.program.hash).not.toBe(host.program.hash);
  });

  it('keeps the hash stable across rebuilds of identical inputs', () => {
    expect(createAnimusHost(input).program.hash).toBe(host.program.hash);
  });
});

describe('animus host — tokens', () => {
  it('reads the data-color-mode blocks as the modes and :root as default', () => {
    expect([...(host.tokens?.modes() ?? [])].sort()).toEqual(['dark', 'light']);
    // `:root` declares `color-scheme: dark`, so the dark block is the one whose
    // values already apply when no mode is pinned.
    expect(host.tokens?.defaultMode()).toBe('dark');
    expect(host.tokens?.all().length).toBe(22);
  });

  it('resolves a token per mode', () => {
    expect(host.tokens?.resolve('--color-danger', 'dark')).toEqual({
      value: '#ef4444',
      chain: ['--color-danger'],
    });
    expect(host.tokens?.resolve('--color-danger', 'light')).toEqual({
      value: '#b91c1c',
      chain: ['--color-danger'],
    });
  });

  it('follows a var() chain through the :root aliases', () => {
    expect(host.tokens?.token('--color-primary')?.valuesByMode.root).toBe(
      'var(--color-blue-500)'
    );
    expect(host.tokens?.resolve('--color-primary', 'root')).toEqual({
      value: '#3b82f6',
      chain: ['--color-primary', '--color-blue-500'],
    });
    expect(host.tokens?.token('--color-primary')?.references).toContain(
      '--color-blue-500'
    );
  });

  it('returns nothing rather than a guess for an unmodeled variable', () => {
    expect(host.tokens?.resolve('--not-a-token', 'dark')).toBeUndefined();
  });

  it('records the prefers-color-scheme fallback as a note, not a mode', () => {
    expect(host.tokens?.modes()).not.toContain('root');
    expect(host.tokens?.notes().join('\n')).toMatch(
      /prefers-color-scheme.*not modeled as scenario modes/s
    );
  });
});

describe('animus host — scenarios', () => {
  it('declares viewport, mode and per-component variant/state axes', () => {
    const dimensions = host.scenarios.dimensions();

    expect(dimensions['viewport.inline']).toEqual({
      kind: 'interval',
      min: 320,
      max: 1440,
    });
    expect(dimensions.mode).toEqual({
      kind: 'finite',
      values: ['dark', 'light'],
    });
    expect(dimensions['variant:Alert:intent']).toEqual({
      kind: 'finite',
      values: ['info', 'danger', 'success'],
    });
    expect(dimensions['state:Badge:disabled']).toEqual({
      kind: 'finite',
      values: [false, true],
    });
  });

  it('qualifies a colliding binding with the full component id', () => {
    const names = Object.keys(host.scenarios.dimensions());

    // Two components bind `Button`; a shared `variant:Button:*` axis would
    // silently move whichever one the caller did not mean.
    expect(names).not.toContain('variant:Button:variant');
    expect(names).toContain('variant:src/Button.tsx::Button:tone');
    expect(names).toContain(`variant:${TEST_DS}/Button.tsx::Button:variant`);
  });

  it('names one scenario per breakpoint band and mode', () => {
    expect(host.scenarios.namedScenarios()).toEqual({
      'base.dark': { 'viewport.inline': 480, mode: 'dark' },
      'base.light': { 'viewport.inline': 480, mode: 'light' },
      'sm.dark': { 'viewport.inline': 704, mode: 'dark' },
      'sm.light': { 'viewport.inline': 704, mode: 'light' },
      'md.dark': { 'viewport.inline': 896, mode: 'dark' },
      'md.light': { 'viewport.inline': 896, mode: 'light' },
      'lg.dark': { 'viewport.inline': 1232, mode: 'dark' },
      'lg.light': { 'viewport.inline': 1232, mode: 'light' },
    });
  });

  it('honours a caller-supplied viewport interval', () => {
    const narrow = createAnimusHost({
      ...input,
      options: { viewportMax: 700 },
    });

    expect(narrow.scenarios.dimensions()['viewport.inline']).toEqual({
      kind: 'interval',
      min: 320,
      max: 700,
    });
    expect(Object.keys(narrow.scenarios.namedScenarios())).toEqual([
      'base.dark',
      'base.light',
      'sm.dark',
      'sm.light',
    ]);
  });
});

describe('animus host — identity', () => {
  it('resolves a component id always and a bare binding only when unique', () => {
    expect(host.identity.resolveTarget('Alert')).toBeDefined();
    expect(host.identity.resolveTarget('Button')).toBeUndefined();
    expect(host.identity.resolveTarget('src/Button.tsx::Button')).toBeDefined();
    expect(host.identity.resolveTarget('Nope')).toBeUndefined();
  });

  it('carries the builder chain span as the component source', () => {
    const alert = host.identity.componentById(ALERT_ID);

    expect(alert).toMatchObject({
      binding: 'Alert',
      className: 'animus-Alert-a385f997',
      terminal: 'asElement',
      tag: 'div',
    });
    expect(alert?.source?.file.endsWith('Alert.tsx')).toBe(true);
    expect(alert?.source?.span).toEqual([54, 899]);
  });

  it('emits classes in resolveClasses order: base, variants, compounds', () => {
    const target = host.identity.resolveTarget('Alert');

    expect(
      target?.classes({
        'variant:Alert:variant': 'outline',
        'variant:Alert:intent': 'danger',
      })
    ).toEqual([
      'animus-Alert-a385f997',
      'animus-Alert-a385f997--variant-outline',
      'animus-Alert-a385f997--intent-danger',
      'animus-Alert-a385f997--compound-1',
    ]);
    expect(target?.classes({})).toEqual(['animus-Alert-a385f997']);
  });

  it('emits --{prop}-default for an unbound prop that declares a default', () => {
    const target = host.identity.resolveTarget('ContainerCardRoot');

    expect(target?.classes({})).toEqual([
      'animus-ContainerCardRoot-01c5b011',
      'animus-ContainerCardRoot-01c5b011--size-default',
    ]);
    expect(target?.classes({ 'variant:ContainerCardRoot:size': 'lg' })).toEqual(
      [
        'animus-ContainerCardRoot-01c5b011',
        'animus-ContainerCardRoot-01c5b011--size-lg',
      ]
    );
  });

  it('appends a state class only when its dimension is truthy', () => {
    const target = host.identity.resolveTarget('Badge');

    expect(target?.classes({ 'state:Badge:disabled': false })).toEqual([
      'animus-Badge-99781d29',
    ]);
    expect(
      target?.classes({
        'state:Badge:disabled': true,
        'state:Badge:active': true,
      })
    ).toEqual([
      'animus-Badge-99781d29',
      'animus-Badge-99781d29--disabled',
      'animus-Badge-99781d29--active',
    ]);
  });

  it('scopes a target to its own axes plus the unscoped ones', () => {
    // Same contract as the in-memory provider: shared axes (mode, viewport)
    // affect every component, so leaving them out silently stops every
    // domain-quantified engine from sweeping them.
    expect(
      Object.keys(host.identity.resolveTarget('Alert')?.dimensions ?? {}).sort()
    ).toEqual([
      'mode',
      'variant:Alert:intent',
      'variant:Alert:variant',
      'viewport.inline',
    ]);
  });
});

describe('animus host — dependencies', () => {
  it('inverts source files to the rules they produced', () => {
    const rules = host.dependencies.rulesOfSource(`${TEST_DS}/Alert.tsx`);

    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      expect(host.universe.universe().ruleById(rule)?.origin?.component).toBe(
        ALERT_ID
      );
    }
    expect(host.dependencies.rulesOfSource('src/nope.tsx')).toEqual([]);
  });

  it('names file, component, manifest and transitive token dependencies', () => {
    const [rule] = host.universe
      .universe()
      .rules.filter(
        (candidate) =>
          candidate.selector.raw === '.animus-Alert-a385f997--intent-danger'
      );
    const dependencies = host.dependencies.dependenciesOfRule(rule.id);

    expect(dependencies).toContain(`file:${TEST_DS}/Alert.tsx`);
    expect(dependencies).toContain(`component:${ALERT_ID}`);
    expect(dependencies).toContain('token:--color-danger');
    // `--color-danger: var(--color-red-500)` at :root — a change to the link
    // has to invalidate this rule too, or stale evidence survives it.
    expect(dependencies).toContain('token:--color-red-500');
    expect(dependencies).toContain(`manifest:${host.program.hash}`);
  });
});

describe('animus host — obligations', () => {
  const byClass = host
    .obligations()
    .reduce<Record<string, number>>((counts, obligation) => {
      counts[obligation.effectClass] =
        (counts[obligation.effectClass] ?? 0) + 1;
      return counts;
    }, {});

  it('declares one obligation per unmodeled influence, by effect class', () => {
    expect(byClass).toEqual({
      'tree-shape': 3,
      geometry: 4,
      'dynamic-value': 67,
    });
  });

  it('points a tree-shape obligation at the authored source and its rule', () => {
    const [obligation] = host
      .obligations()
      .filter((entry) => entry.effectClass === 'tree-shape');

    expect(obligation.origin.file.endsWith('GroupItem.tsx')).toBe(true);
    expect(obligation.influenceScope.map((subject) => subject.kind)).toContain(
      'component'
    );
    expect(obligation.dischargeOptions.map((option) => option.kind)).toEqual([
      'contract-application',
      'context-capsule-measurement',
    ]);
  });

  it('names the variable a dynamic-value obligation leaves unbound', () => {
    const [obligation] = host
      .obligations()
      .filter(
        (entry) =>
          entry.effectClass === 'dynamic-value' && entry.reason.includes('`p`')
      );

    expect(obligation.reason).toMatch(/--animus-p/);
    expect(obligation.reason).toMatch(/animus-dyn-p/);
    expect(obligation.dischargeOptions.map((option) => option.kind)).toEqual([
      'fixture-lookup',
      'context-capsule-measurement',
    ]);
    expect(obligation.dependencies).toContain(`manifest:${host.program.hash}`);
  });
});

describe('animus host — degraded and failing inputs', () => {
  it('stays functional without a stylesheet, minus tokens and mode', () => {
    const degraded = createAnimusHost({ manifest: input.manifest });

    expect(degraded.tokens).toBeUndefined();
    expect(Object.keys(degraded.scenarios.dimensions())).not.toContain('mode');
    expect(degraded.universe.universe().rules.length).toBe(
      host.universe.universe().rules.length
    );
    // No token block means no breakpoints and no modes: one unbanded,
    // unmoded scenario is all the artifacts still support.
    expect(degraded.scenarios.namedScenarios()).toEqual({
      base: { 'viewport.inline': 880 },
    });
    expect(degraded.universe.universe().exclusions.join('\n')).toMatch(
      /no stylesheet text was supplied/
    );
  });

  it('rejects a directory that is not an artifact set, naming the gap', () => {
    expect(() => loadAnimusArtifacts(join(FIXTURE, 'nope'))).toThrow(
      AnimusAdapterError
    );
    expect(() => loadAnimusArtifacts(join(FIXTURE, 'nope'))).toThrow(
      /missing manifest\.json and styles\.css/
    );
    expect(() => loadAnimusArtifacts(join(FIXTURE, 'nope'))).toThrow(
      /animus build/
    );
  });

  it('rejects an input that is not an extraction manifest', () => {
    expect(() => createAnimusHost({ manifest: { sheets: {} } })).toThrow(
      /no `components` map/
    );
    expect(() => createAnimusHost({ manifest: 'nope' })).toThrow(
      AnimusAdapterError
    );
  });

  it('names what a rejected non-manifest actually was', () => {
    // The refusal has to be actionable: a list and a `null` are different
    // mistakes, and reporting both as the same coarse bucket would send a
    // reader looking for the wrong thing.
    expect(() => createAnimusHost({ manifest: [] })).toThrow(/got array/);
    expect(() => createAnimusHost({ manifest: null })).toThrow(/got null/);
    expect(() => createAnimusHost({ manifest: 'nope' })).toThrow(/got string/);
  });
});
