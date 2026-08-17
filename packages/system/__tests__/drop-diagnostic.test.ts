import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import * as classResolutionRuntime from '../src/runtime/resolveClasses';
import { loadUnderNodeEnv } from './load-under-node-env';

import type { DynamicPropConfig } from '../src/runtime/resolveClasses';
import type { WitnessRecord } from '../src/runtime/witness';

const {
  resolveClasses,
  serializeValueKey,
  ['describeResultShape']: describeInvalidTransformResult,
} = classResolutionRuntime;

type WitnessRuntimeGlobal = typeof globalThis & {
  __ANIMUS_WITNESS__?: WitnessRecord[];
};

const witnessRuntimeGlobal: WitnessRuntimeGlobal = globalThis;

const config = (base: Partial<Parameters<typeof resolveClasses>[2]> = {}) => ({
  systemPropNames: ['p'],
  ...base,
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('drop diagnostic', () => {
  test('static map hit resolves identically and emits no warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = resolveClasses('animus-A-static1', { p: 8 }, config(), {
      p: { '8': 'animus-u-abc' },
    });
    expect(res.classes).toEqual(['animus-A-static1', 'animus-u-abc']);
    expect(res.dynamicStyle).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  test('dynamic slot hit resolves identically and emits no warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = resolveClasses(
      'animus-A-dyn1',
      { p: 12 },
      config(),
      undefined,
      { p: { varName: '--animus-p', slotClass: 'animus-dyn-p' } }
    );
    expect(res.classes).toEqual(['animus-A-dyn1', 'animus-dyn-p']);
    expect(res.dynamicStyle).toEqual({ '--animus-p': '12px' });
    expect(warn).not.toHaveBeenCalled();
  });

  test('unresolvable value warns with component, prop, and serialized value', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = resolveClasses('animus-A-drop1', { p: 999 }, config());
    expect(res.classes).toEqual(['animus-A-drop1']);
    expect(warn).toHaveBeenCalledTimes(1);
    const msg = String(warn.mock.calls[0][0]);
    expect(msg).toContain('animus:drop');
    expect(msg).toContain('animus-A-drop1');
    expect(msg).toContain('p');
    expect(msg).toContain('999');
  });

  test('serializes responsive values exactly in the warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const value = { md: 24, _: 8 };
    const serializedValue = serializeValueKey(value);
    expect(serializedValue).toBe('_:8|md:24');

    resolveClasses('animus-A-responsive-drop1', { p: value }, config());

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain(serializedValue);
  });

  test('warns once per (component, prop) pair', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    resolveClasses('animus-A-once1', { p: 1 }, config());
    resolveClasses('animus-A-once1', { p: 2 }, config());
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test('warns independently for distinct component and prop pairs', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    resolveClasses('animus-A-pairs1', { p: 1 }, config());
    resolveClasses('animus-A-pairs2', { p: 2 }, config());
    resolveClasses(
      'animus-A-pairs1',
      { q: 3 },
      config({ systemPropNames: ['q'] })
    );
    expect(warn).toHaveBeenCalledTimes(3);
  });

  test('production mode emits no warning', async () => {
    const prod = await loadUnderNodeEnv('production');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    prod.resolveClasses('animus-A-prod1', { p: 999 }, config());
    expect(warn).not.toHaveBeenCalled();
  });

  test('non-production mode warns from a freshly loaded module', async () => {
    const dev = await loadUnderNodeEnv('development');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    dev.resolveClasses('animus-A-dev1', { p: 999 }, config());
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test('a partial process global at call time cannot disable the diagnostic', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('process', {});

    expect(() =>
      resolveClasses('animus-A-partial1', { p: 999 }, config())
    ).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('invalid transform result gate', () => {
  type DynamicPropFixture = DynamicPropConfig[string];
  type RejectedTransformFixtureResult = object | boolean | undefined;

  const witnesses = () => witnessRuntimeGlobal.__ANIMUS_WITNESS__;

  const dynamicPropFixture = (
    overrides: Partial<DynamicPropFixture> = {}
  ): DynamicPropFixture => ({
    varName: '--animus-p',
    slotClass: 'animus-dyn-p',
    ...overrides,
  });

  const dyn = (
    overrides: Partial<DynamicPropFixture> = {}
  ): DynamicPropConfig => ({
    p: dynamicPropFixture(overrides),
  });

  /**
   * Installs a contract-violating transform result at runtime so the defensive
   * gate is exercised without claiming that the value satisfies its static
   * string-or-number return contract.
   */
  const withRuntimeTransformResult = (
    result: RejectedTransformFixtureResult,
    overrides: Partial<DynamicPropFixture> = {}
  ): DynamicPropFixture => {
    const fixture = dynamicPropFixture(overrides);
    Object.defineProperty(fixture, 'transform', {
      configurable: true,
      enumerable: true,
      value: () => result,
      writable: true,
    });
    return fixture;
  };

  const dynWithRuntimeTransformResult = (
    result: RejectedTransformFixtureResult,
    overrides: Partial<DynamicPropFixture> = {}
  ): DynamicPropConfig => ({
    p: withRuntimeTransformResult(result, overrides),
  });

  beforeEach(() => {
    delete witnessRuntimeGlobal.__ANIMUS_WITNESS__;
  });

  test('scalar object result applies nothing, witnesses drop, warns naming the invalid result kind', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = resolveClasses(
      'animus-G-obj1',
      { p: 5 },
      config(),
      undefined,
      dynWithRuntimeTransformResult({ bad: true })
    );
    expect(res.classes).toEqual(['animus-G-obj1']);
    expect(res.dynamicStyle).toBeUndefined();
    expect(witnesses()).toEqual([
      { component: 'animus-G-obj1', prop: 'p', value: '5', outcome: 'drop' },
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toBe(
      "[animus:drop] animus-G-obj1: transform for prop 'p' returned object — expected string or finite number; value dropped"
    );
  });

  test('responsive value with one invalid breakpoint applies nothing at all', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = resolveClasses(
      'animus-G-resp1',
      { p: { _: 4, sm: 8 } },
      config(),
      undefined,
      dyn({ transform: (v) => (v === 8 ? Number.NaN : v) })
    );
    expect(res.classes).toEqual(['animus-G-resp1']);
    expect(res.dynamicStyle).toBeUndefined();
    expect(witnesses()).toEqual([
      {
        component: 'animus-G-resp1',
        prop: 'p',
        value: '_:4|sm:8',
        outcome: 'drop',
      },
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('non-finite-number');
  });

  // The staging target aliases the live dynStyle once one exists; these two
  // pin that an earlier prop's applied variables survive a later prop's drop
  // (and the reverse), which no single-prop case can observe.
  test("valid prop then invalid prop: the first prop's slot and variable survive", () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = resolveClasses(
      'animus-G-pair1',
      { p: 4, m: 6 },
      config({ systemPropNames: ['p', 'm'] }),
      undefined,
      {
        p: { varName: '--animus-p', slotClass: 'animus-dyn-p' },
        m: withRuntimeTransformResult(
          { bad: true },
          { varName: '--animus-m', slotClass: 'animus-dyn-m' }
        ),
      }
    );
    expect(res.classes).toEqual(['animus-G-pair1', 'animus-dyn-p']);
    expect(res.dynamicStyle).toEqual({ '--animus-p': '4px' });
    expect(witnesses()).toEqual([
      {
        component: 'animus-G-pair1',
        prop: 'p',
        value: '4',
        outcome: 'dynamic',
      },
      { component: 'animus-G-pair1', prop: 'm', value: '6', outcome: 'drop' },
    ]);
  });

  test('invalid prop then valid prop: the later prop still applies cleanly', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = resolveClasses(
      'animus-G-pair2',
      { p: 4, m: 8 },
      config({ systemPropNames: ['p', 'm'] }),
      undefined,
      {
        p: withRuntimeTransformResult({ bad: true }),
        m: { varName: '--animus-m', slotClass: 'animus-dyn-m' },
      }
    );
    expect(res.classes).toEqual(['animus-G-pair2', 'animus-dyn-m']);
    expect(res.dynamicStyle).toEqual({ '--animus-m': '8px' });
    expect(witnesses()).toEqual([
      { component: 'animus-G-pair2', prop: 'p', value: '4', outcome: 'drop' },
      {
        component: 'animus-G-pair2',
        prop: 'm',
        value: '8',
        outcome: 'dynamic',
      },
    ]);
  });

  test('valid numeric transform results resolve byte-identical to the ungated path', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = resolveClasses(
      'animus-G-valid1',
      { p: { _: 4, sm: 8 } },
      config(),
      undefined,
      dyn({ transform: (v) => Number(v) * 2 })
    );
    expect(res.classes).toEqual([
      'animus-G-valid1',
      'animus-dyn-p',
      'animus-dyn-p-sm',
    ]);
    expect(res.dynamicStyle).toEqual({
      '--animus-p': '8px',
      '--animus-p-sm': '16px',
    });
    expect(witnesses()).toEqual([
      {
        component: 'animus-G-valid1',
        prop: 'p',
        value: '_:4|sm:8',
        outcome: 'dynamic',
      },
    ]);
    expect(warn).not.toHaveBeenCalled();
  });

  test('valid string transform result resolves exactly, witnessed dynamic', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = resolveClasses(
      'animus-G-valid2',
      { p: 3 },
      config(),
      undefined,
      dyn({ transform: (v) => `${v}rem` })
    );
    expect(res.classes).toEqual(['animus-G-valid2', 'animus-dyn-p']);
    expect(res.dynamicStyle).toEqual({ '--animus-p': '3rem' });
    expect(witnesses()).toEqual([
      {
        component: 'animus-G-valid2',
        prop: 'p',
        value: '3',
        outcome: 'dynamic',
      },
    ]);
    expect(warn).not.toHaveBeenCalled();
  });

  test('scaleValues hit without a transform is exempt from the gate', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = resolveClasses(
      'animus-G-scale1',
      { p: 'sm' },
      config(),
      undefined,
      dyn({ scaleValues: { sm: '4rem' } })
    );
    expect(res.classes).toEqual(['animus-G-scale1', 'animus-dyn-p']);
    expect(res.dynamicStyle).toEqual({ '--animus-p': '4rem' });
    expect(witnesses()).toEqual([
      {
        component: 'animus-G-scale1',
        prop: 'p',
        value: 'sm',
        outcome: 'dynamic',
      },
    ]);
    expect(warn).not.toHaveBeenCalled();
  });

  test('scale-resolved arm validates a configured transform result', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = resolveClasses(
      'animus-G-scale2',
      { p: 'sm' },
      config(),
      undefined,
      dynWithRuntimeTransformResult(undefined, {
        scaleValues: { sm: '4rem' },
      })
    );
    expect(res.classes).toEqual(['animus-G-scale2']);
    expect(res.dynamicStyle).toBeUndefined();
    expect(witnesses()).toEqual([
      { component: 'animus-G-scale2', prop: 'p', value: 'sm', outcome: 'drop' },
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('undefined');
  });

  test('invalid-result warning dedupes per component and prop across renders', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const dc = dynWithRuntimeTransformResult(false);
    const first = resolveClasses(
      'animus-G-dedupe1',
      { p: 1 },
      config(),
      undefined,
      dc
    );
    const second = resolveClasses(
      'animus-G-dedupe1',
      { p: 2 },
      config(),
      undefined,
      dc
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(first.classes).toEqual(['animus-G-dedupe1']);
    expect(second.classes).toEqual(['animus-G-dedupe1']);
    expect(second.dynamicStyle).toBeUndefined();
  });

  test('production build drops silently with no witness handle', async () => {
    const prod = await loadUnderNodeEnv('production');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = prod.resolveClasses(
      'animus-G-prod1',
      { p: 5 },
      config(),
      undefined,
      dynWithRuntimeTransformResult({})
    );
    expect(res.classes).toEqual(['animus-G-prod1']);
    expect(res.dynamicStyle).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
    expect(witnessRuntimeGlobal.__ANIMUS_WITNESS__).toBeUndefined();
  });

  test('invalid-result descriptors name every rejected runtime kind', () => {
    expect(describeInvalidTransformResult({})).toBe('object');
    expect(describeInvalidTransformResult([])).toBe('array');
    expect(describeInvalidTransformResult(null)).toBe('null');
    expect(describeInvalidTransformResult(true)).toBe('boolean');
    expect(describeInvalidTransformResult(undefined)).toBe('undefined');
    expect(describeInvalidTransformResult(() => {})).toBe('function');
    expect(describeInvalidTransformResult(Number.NaN)).toBe(
      'non-finite-number'
    );
    expect(describeInvalidTransformResult(Infinity)).toBe('non-finite-number');
  });
});
