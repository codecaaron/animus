import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { resolveClasses } from '../src/runtime/resolveClasses';
import { recordWitness, WITNESS_CAP } from '../src/runtime/witness';
import { loadUnderNodeEnv } from './load-under-node-env';

import type { DynamicPropConfig } from '../src/runtime/resolveClasses';
import type { WitnessRecord } from '../src/runtime/witness';

/** The dev-only handle `recordWitness` installs, named exactly as it types it. */
type WitnessRuntimeGlobal = typeof globalThis & {
  __ANIMUS_WITNESS__?: WitnessRecord[];
};

const witnessRuntimeGlobal: WitnessRuntimeGlobal = globalThis;

const buffer = (): WitnessRecord[] => {
  const recorded = witnessRuntimeGlobal.__ANIMUS_WITNESS__;
  if (!recorded) {
    throw new Error('expected the dev witness handle to be installed');
  }
  return recorded;
};

/**
 * A dynamic entry whose transform returns null at runtime — outside the
 * `string | number` return its own contract declares. `defineProperty`
 * installs exactly the own, enumerable, writable, configurable property an
 * object literal would, without claiming the violating callback satisfies
 * that contract.
 */
const nullResultTransformEntry = (): DynamicPropConfig[string] => {
  const entry: DynamicPropConfig[string] = {
    varName: '--animus-p',
    slotClass: 'animus-dyn-p',
  };
  Object.defineProperty(entry, 'transform', {
    configurable: true,
    enumerable: true,
    value: () => null,
    writable: true,
  });
  return entry;
};

beforeEach(() => {
  delete witnessRuntimeGlobal.__ANIMUS_WITNESS__;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('witness recording', () => {
  test('static, dynamic, and drop outcomes are witnessed through resolveClasses', () => {
    resolveClasses(
      'animus-W-a',
      { p: 8, m: 4, gap: 2 },
      { systemPropNames: ['p', 'm', 'gap'] },
      { p: { '8': 'animus-u-p8' } },
      { m: { varName: '--animus-m', slotClass: 'animus-dyn-m' } }
    );
    expect(buffer()).toEqual([
      { component: 'animus-W-a', prop: 'p', value: '8', outcome: 'static' },
      { component: 'animus-W-a', prop: 'm', value: '4', outcome: 'dynamic' },
      { component: 'animus-W-a', prop: 'gap', value: '2', outcome: 'drop' },
    ]);
  });

  test('variant and state resolutions are witnessed as static', () => {
    resolveClasses(
      'animus-W-b',
      { size: 'lg', active: true },
      {
        variants: { size: { options: ['sm', 'lg'] } },
        states: ['active'],
      }
    );
    expect(buffer()).toEqual([
      {
        component: 'animus-W-b',
        prop: 'size',
        value: 'lg',
        outcome: 'static',
      },
      {
        component: 'animus-W-b',
        prop: 'active',
        value: 'true',
        outcome: 'static',
      },
    ]);
  });

  test('invalid transform result is witnessed as drop, not dynamic', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    resolveClasses(
      'animus-W-invalid',
      { p: 3 },
      { systemPropNames: ['p'] },
      undefined,
      { p: nullResultTransformEntry() }
    );
    try {
      expect(buffer()).toEqual([
        {
          component: 'animus-W-invalid',
          prop: 'p',
          value: '3',
          outcome: 'drop',
        },
      ]);
    } finally {
      warn.mockRestore();
    }
  });

  test('buffer is a ring bounded by WITNESS_CAP', () => {
    for (let i = 0; i < WITNESS_CAP + 10; i++) {
      recordWitness('animus-W-c', 'p', String(i), 'static');
    }
    expect(buffer()).toHaveLength(WITNESS_CAP);
    expect(buffer()[0].value).toBe('10');
    expect(buffer()[WITNESS_CAP - 1].value).toBe(String(WITNESS_CAP + 9));
  });

  test('production mode records nothing and creates no global', async () => {
    const prod = await loadUnderNodeEnv('production');
    prod.recordWitness('animus-W-d', 'p', '1', 'static');
    prod.resolveClasses('animus-W-d', { p: 8 }, { systemPropNames: ['p'] });
    expect(witnessRuntimeGlobal.__ANIMUS_WITNESS__).toBeUndefined();
  });

  test('production variant resolution does not serialize witness values', async () => {
    const prod = await loadUnderNodeEnv('production');
    let serializations = 0;
    const value = {
      toString() {
        serializations += 1;
        return 'lg';
      },
    };

    expect(
      prod.resolveClasses(
        'animus-W-production-variant',
        { size: value },
        { variants: { size: { options: ['lg'] } } }
      ).classes
    ).toEqual([
      'animus-W-production-variant',
      'animus-W-production-variant--size-lg',
    ]);
    expect(serializations).toBe(1);
  });

  test('a partial process global at call time cannot disable recording', () => {
    vi.stubGlobal('process', {});

    expect(() =>
      recordWitness('animus-W-partial', 'p', '1', 'static')
    ).not.toThrow();
    expect(buffer()).toEqual([
      {
        component: 'animus-W-partial',
        prop: 'p',
        value: '1',
        outcome: 'static',
      },
    ]);
  });
});
