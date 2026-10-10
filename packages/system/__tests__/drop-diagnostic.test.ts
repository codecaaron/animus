import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import * as classResolutionRuntime from '../src/runtime/resolveClasses';

type ValuePropConfig = Extract<DynamicPropConfig[string], { varName: string }>;
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
  type DynamicPropFixture = ValuePropConfig;
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
   * Installs a contract-violating transform result without claiming it
   * satisfies the static string-or-number return contract.
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

describe('runtime transform exception boundary', () => {
  const witnesses = () => witnessRuntimeGlobal.__ANIMUS_WITNESS__;

  const explode = (v: string | number) => {
    if (v === 13) throw new RangeError('13 is unlucky');
    return Number(v) * 2;
  };

  const dyn = (
    overrides: Partial<ValuePropConfig> = {}
  ): DynamicPropConfig => ({
    p: {
      varName: '--animus-p',
      slotClass: 'animus-dyn-p',
      transform: explode,
      ...overrides,
    },
  });

  beforeEach(() => {
    delete witnessRuntimeGlobal.__ANIMUS_WITNESS__;
  });

  test('a throwing named transform drops the prop and warns with its attribution', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = resolveClasses(
      'animus-T-named1',
      { p: 13 },
      config(),
      undefined,
      dyn({ transformName: 'explode' })
    );
    expect(res.classes).toEqual(['animus-T-named1']);
    expect(res.dynamicStyle).toBeUndefined();
    expect(witnesses()).toEqual([
      { component: 'animus-T-named1', prop: 'p', value: '13', outcome: 'drop' },
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toBe(
      "[animus:drop] animus-T-named1: transform 'explode' for prop 'p' threw for value 13 (RangeError: 13 is unlucky); prop styling dropped"
    );
    const stack = String(warn.mock.calls[0][1]);
    expect(stack).toContain('RangeError: 13 is unlucky');
    expect(stack).toContain('drop-diagnostic.test.ts');
  });

  test('a throwing inline transform is attributed as inline', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = resolveClasses(
      'animus-T-inline1',
      { p: 13 },
      config(),
      undefined,
      dyn()
    );
    expect(res.classes).toEqual(['animus-T-inline1']);
    expect(String(warn.mock.calls[0][0])).toBe(
      "[animus:drop] animus-T-inline1: inline transform for prop 'p' threw for value 13 (RangeError: 13 is unlucky); prop styling dropped"
    );
  });

  test('a throw at one breakpoint drops every entry of that prop and spares its siblings', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = resolveClasses(
      'animus-T-resp1',
      { p: { _: 4, sm: 13 }, m: 6, gap: 2 },
      config({ systemPropNames: ['p', 'm', 'gap'] }),
      { gap: { '2': 'animus-u-gap2' } },
      {
        ...dyn(),
        m: { varName: '--animus-m', slotClass: 'animus-dyn-m' },
      }
    );
    expect(res.classes).toEqual([
      'animus-T-resp1',
      'animus-dyn-m',
      'animus-u-gap2',
    ]);
    expect(res.dynamicStyle).toEqual({ '--animus-m': '6px' });
    expect(witnesses()?.map(({ prop, outcome }) => [prop, outcome])).toEqual([
      ['p', 'drop'],
      ['m', 'dynamic'],
      ['gap', 'static'],
    ]);
  });

  test('valid, throwing and valid again resolve independently', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const render = (p: number) =>
      resolveClasses('animus-T-recover1', { p }, config(), undefined, dyn());
    expect(render(4).dynamicStyle).toEqual({ '--animus-p': '8px' });
    const thrown = render(13);
    expect(thrown.classes).toEqual(['animus-T-recover1']);
    expect(thrown.dynamicStyle).toBeUndefined();
    const recovered = render(5);
    expect(recovered.classes).toEqual(['animus-T-recover1', 'animus-dyn-p']);
    expect(recovered.dynamicStyle).toEqual({ '--animus-p': '10px' });
  });

  test('warns once per rejected value across repeated renders', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const dc = dyn({
      transform: (v) => {
        // oxlint-disable-next-line no-throw-literal -- a non-Error throw keeps its reason
        throw `no ${v}`;
      },
    });
    resolveClasses('animus-T-dedupe1', { p: 1 }, config(), undefined, dc);
    resolveClasses('animus-T-dedupe1', { p: 1 }, config(), undefined, dc);
    expect(warn).toHaveBeenCalledTimes(1);
    resolveClasses('animus-T-dedupe1', { p: 2 }, config(), undefined, dc);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls[1][0])).toContain('value 2 (no 2)');
    expect(warn.mock.calls[1]).toHaveLength(1);
  });

  test('an unprintable thrown value or stack still drops and warns safely', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const noStack = new Error('boom');
    Object.defineProperty(noStack, 'stack', {
      get() {
        throw new Error('stack unavailable');
      },
    });
    let stackReads = 0;
    const shiftingStack = new Error('shifting');
    Object.defineProperty(shiftingStack, 'stack', {
      get() {
        stackReads += 1;
        return stackReads === 1
          ? 'Error: shifting\n    at callback'
          : { marker: 'not a stack string' };
      },
    });
    for (const [base, thrown] of [
      ['animus-T-hostile1', Object.create(null)],
      ['animus-T-hostile2', noStack],
      ['animus-T-hostile3', shiftingStack],
    ] as const) {
      const res = resolveClasses(
        base,
        { p: { _: 4, sm: 3 } },
        config(),
        undefined,
        dyn({
          transform: (v) => {
            if (v === 3) throw thrown;
            return v;
          },
        })
      );
      expect(res.classes).toEqual([base]);
      expect(res.dynamicStyle).toBeUndefined();
    }
    expect(warn.mock.calls.map((call) => call.length)).toEqual([1, 1, 2]);
    expect(String(warn.mock.calls[0][0])).toContain(
      '(unprintable thrown value)'
    );
    expect(String(warn.mock.calls[1][0])).toContain('(Error: boom)');
    expect(stackReads).toBe(1);
    expect(warn.mock.calls[2][1]).toBe('Error: shifting\n    at callback');
  });

  test('resolveValue reports a throw as an unresolvable value', () => {
    expect(
      classResolutionRuntime.resolveValue(13, {
        varName: '--animus-p',
        transform: explode,
      })
    ).toBeNull();
  });

  test('production drops a throw silently', async () => {
    const prod = await loadUnderNodeEnv('production');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = prod.resolveClasses(
      'animus-T-prod1',
      { p: 13 },
      config(),
      undefined,
      dyn({ transformName: 'explode' })
    );
    expect(res.classes).toEqual(['animus-T-prod1']);
    expect(res.dynamicStyle).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('strict scale miss', () => {
  const witnesses = () => witnessRuntimeGlobal.__ANIMUS_WITNESS__;

  const globals = [
    '-moz-initial',
    'inherit',
    'initial',
    'revert',
    'revert-layer',
    'unset',
  ];

  const space = {
    varName: '--animus-p',
    slotClass: 'animus-dyn-p',
    property: 'padding',
    strict: true,
    keywords: globals,
    negative: true,
    scaleValues: { 0: '0', 4: '1rem', 40: 'var(--space-40)', '-4': '2rem' },
  } satisfies ValuePropConfig;

  const dyn = (
    overrides: Partial<ValuePropConfig> = {}
  ): DynamicPropConfig => ({ p: { ...space, ...overrides } });

  beforeEach(() => {
    delete witnessRuntimeGlobal.__ANIMUS_WITNESS__;
  });

  test.each([13, -13])(
    'unknown token %s drops the prop and warns with the authored value',
    (value) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const base = `animus-S-miss${value}`;
      const res = resolveClasses(
        base,
        { p: value },
        config(),
        undefined,
        dyn()
      );
      expect(res.classes).toEqual([base]);
      expect(res.dynamicStyle).toBeUndefined();
      expect(witnesses()).toEqual([
        { component: base, prop: 'p', value: String(value), outcome: 'drop' },
      ]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toBe(
        `[animus:drop] ${base}: value ${value} on prop 'p' is not a token of its strict scale; prop styling dropped`
      );
    }
  );

  test('known, exact and admitted negative tokens still resolve', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const style = (p: number) =>
      resolveClasses('animus-S-known1', { p }, config(), undefined, dyn())
        .dynamicStyle;
    expect(style(4)).toEqual({ '--animus-p': '1rem' });
    expect(style(-40)).toEqual({ '--animus-p': 'calc(var(--space-40) * -1)' });
    expect(style(-4)).toEqual({ '--animus-p': '2rem' });
    expect(warn).not.toHaveBeenCalled();
  });

  test('a negative counterpart without negative admission is a miss', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = resolveClasses(
      'animus-S-unadmitted1',
      { p: -40 },
      config(),
      undefined,
      dyn({ negative: false })
    );
    expect(res.classes).toEqual(['animus-S-unadmitted1']);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test('a miss at one breakpoint drops every entry of that prop and spares its siblings', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = resolveClasses(
      'animus-S-resp1',
      { p: { _: 4, sm: 13 }, m: 6, gap: 2 },
      config({ systemPropNames: ['p', 'm', 'gap'] }),
      { gap: { '2': 'animus-u-gap2' } },
      {
        ...dyn(),
        m: { varName: '--animus-m', slotClass: 'animus-dyn-m' },
      }
    );
    expect(res.classes).toEqual([
      'animus-S-resp1',
      'animus-dyn-m',
      'animus-u-gap2',
    ]);
    expect(res.dynamicStyle).toEqual({ '--animus-m': '6px' });
    expect(witnesses()?.map(({ prop, outcome }) => [prop, outcome])).toEqual([
      ['p', 'drop'],
      ['m', 'dynamic'],
      ['gap', 'static'],
    ]);
    expect(String(warn.mock.calls[0][0])).toBe(
      "[animus:drop] animus-S-resp1: value _:4|sm:13 on prop 'p' is not a token of its strict scale (13 at sm); prop styling dropped"
    );
  });

  test('valid, missing and valid again resolve independently', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const render = (p: number) =>
      resolveClasses('animus-S-recover1', { p }, config(), undefined, dyn());
    expect(render(4).dynamicStyle).toEqual({ '--animus-p': '1rem' });
    const missed = render(13);
    expect(missed.classes).toEqual(['animus-S-recover1']);
    expect(missed.dynamicStyle).toBeUndefined();
    expect(render(0).dynamicStyle).toEqual({ '--animus-p': '0' });
  });

  test('warns once per rejected value across repeated renders', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const p of [13, 13, 13]) {
      resolveClasses('animus-S-dedupe1', { p }, config(), undefined, dyn());
    }
    expect(warn).toHaveBeenCalledTimes(1);
    resolveClasses('animus-S-dedupe1', { p: 17 }, config(), undefined, dyn());
    expect(warn).toHaveBeenCalledTimes(2);
  });

  test('values the strict type admits beside its tokens are not misses', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const value = (p: string | number, overrides = {}) =>
      resolveClasses(
        'animus-S-admit1',
        { p },
        config(),
        undefined,
        dyn(overrides)
      ).dynamicStyle?.['--animus-p'];
    expect(value(0, { scaleValues: { 4: '1rem' } })).toBe('0px');
    expect(value('inherit')).toBe('inherit');
    expect(value('revert-layer')).toBe('revert-layer');
    expect(
      value('auto', { property: 'margin', keywords: [...globals, 'auto'] })
    ).toBe('auto');
    expect(value('2cqi')).toBe('2cqi');
    expect(value('-1.5cqmin')).toBe('-1.5cqmin');
    expect(value('1e2cqi')).toBe('1e2cqi');
    expect(value('10px', { property: 'maxWidth' })).toBe('10px');
    expect(value('1e2px', { property: 'width' })).toBe('1e2px');
    expect(value('.5E-1rem', { property: 'height' })).toBe('.5E-1rem');
    expect(value('calc(1px + 2px)', { property: 'height' })).toBe(
      'calc(1px + 2px)'
    );
    expect(warn).not.toHaveBeenCalled();
  });

  test.each([
    ['2.5rem', 'padding'],
    ['var(--x)', 'padding'],
    ['#fff', 'color'],
    ['-17', 'padding'],
    ['min(1px, 2px)', 'width'],
    [12, 'width'],
    ['lg', 'padding'],
    ['auto', 'padding'],
    ['banana', 'color'],
    ['currentcolor', 'color'],
    ['1.px', 'width'],
    ['0x10px', 'width'],
    ['1e2', 'padding'],
  ])('%s on a strict %s scale is a miss', (p, property) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = resolveClasses(
      'animus-S-reject1',
      { p },
      config(),
      undefined,
      dyn({ property })
    );
    expect(res.classes).toEqual(['animus-S-reject1']);
    expect(res.dynamicStyle).toBeUndefined();
  });

  test('zero is admitted only where the property takes a single length', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const style = (p: string | number, property: string) =>
      resolveClasses(
        'animus-S-zero1',
        { p },
        config(),
        undefined,
        dyn({ property, scaleValues: { 4: '1rem' } })
      ).dynamicStyle;
    for (const property of ['margin', 'padding', 'gap']) {
      expect(style(0, property), property).toEqual({ '--animus-p': '0px' });
      expect(style('0', property), property).toEqual({ '--animus-p': '0' });
    }
    for (const property of [
      'gridTemplateRows',
      'gridTemplateColumns',
      'opacity',
      'textDecoration',
    ]) {
      expect(style(0, property), property).toBeUndefined();
      expect(style('0', property), property).toBeUndefined();
    }
  });

  test('loose and empty scales keep raw values', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const style = (overrides: Partial<ValuePropConfig>) =>
      resolveClasses(
        'animus-S-loose1',
        { p: '2.5rem' },
        config(),
        undefined,
        dyn(overrides)
      ).dynamicStyle;
    expect(style({ strict: undefined })).toEqual({ '--animus-p': '2.5rem' });
    expect(style({ scaleValues: undefined })).toEqual({
      '--animus-p': '2.5rem',
    });
    expect(warn).not.toHaveBeenCalled();
  });

  test('a miss is decided before the transform runs', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const transform = vi.fn((v: string | number) => {
      if (v === 13) throw new RangeError('13 is unlucky');
      return v;
    });
    const res = resolveClasses(
      'animus-S-transform1',
      { p: 13 },
      config(),
      undefined,
      dyn({ transform, transformName: 'explode' })
    );
    expect(res.classes).toEqual(['animus-S-transform1']);
    expect(transform).not.toHaveBeenCalled();
    expect(String(warn.mock.calls[0][0])).toContain(
      'is not a token of its strict scale'
    );
  });

  test('a custom prop never resolves through a same-named system class or slot', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = resolveClasses(
      'animus-S-custom1',
      { inset: 4 },
      {
        systemPropNames: ['inset'],
        customDynamicConfig: {
          inset: { ...space, scaleValues: { sm: '0.5rem' } },
        },
      },
      { inset: { '4': 'animus-u-system-inset' } },
      { inset: { varName: '--animus-inset', slotClass: 'animus-dyn-inset' } }
    );
    expect(res.classes).toEqual(['animus-S-custom1']);
    expect(res.dynamicStyle).toBeUndefined();
  });

  test('a custom prop with no extracted class is still custom-owned', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = resolveClasses(
      'animus-S-owned1',
      { p: 8 },
      { systemPropNames: ['p'], customPropMap: { p: {} } },
      { p: { '8': 'animus-u-system-p' } },
      { p: { varName: '--animus-p', slotClass: 'animus-dyn-p' } }
    );
    expect(res.classes).toEqual(['animus-S-owned1']);
    expect(res.dynamicStyle).toBeUndefined();
    expect(String(warn.mock.calls[0][0])).toBe(
      "[animus:drop] animus-S-owned1: value 8 on custom prop 'p' is none of its extracted values and the prop has no runtime slot — it will not render. A literal missing from the prop's strict scale is reported by the build as animus.props.strict-token-miss; a value passed through an untraced alias is not."
    );
  });

  test('resolveValue reports a miss as an unresolvable value', () => {
    expect(classResolutionRuntime.resolveValue(13, space)).toBeNull();
  });

  test('production drops a miss silently', async () => {
    const prod = await loadUnderNodeEnv('production');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = prod.resolveClasses(
      'animus-S-prod1',
      { p: { _: 4, sm: -13 } },
      config(),
      undefined,
      dyn()
    );
    expect(res.classes).toEqual(['animus-S-prod1']);
    expect(res.dynamicStyle).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });
});
