import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { resolveClasses } from '../src/runtime/resolveClasses';
import { recordWitness, WITNESS_CAP } from '../src/runtime/witness';

type WitnessRecord = {
  component: string;
  prop: string;
  value: string;
  outcome: 'static' | 'dynamic' | 'drop';
};

const buffer = (): WitnessRecord[] =>
  (globalThis as Record<string, unknown>).__ANIMUS_WITNESS__ as WitnessRecord[];

beforeEach(() => {
  delete (globalThis as Record<string, unknown>).__ANIMUS_WITNESS__;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
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

  test('buffer is a ring bounded by WITNESS_CAP', () => {
    for (let i = 0; i < WITNESS_CAP + 10; i++) {
      recordWitness('animus-W-c', 'p', String(i), 'static');
    }
    expect(buffer()).toHaveLength(WITNESS_CAP);
    expect(buffer()[0].value).toBe('10');
    expect(buffer()[WITNESS_CAP - 1].value).toBe(String(WITNESS_CAP + 9));
  });

  test('production mode records nothing and creates no global', () => {
    vi.stubEnv('NODE_ENV', 'production');
    recordWitness('animus-W-d', 'p', '1', 'static');
    resolveClasses('animus-W-d', { p: 8 }, { systemPropNames: ['p'] });
    expect(
      (globalThis as Record<string, unknown>).__ANIMUS_WITNESS__
    ).toBeUndefined();
  });

  test('production variant resolution does not serialize witness values', () => {
    vi.stubEnv('NODE_ENV', 'production');
    let serializations = 0;
    const value = {
      toString() {
        serializations += 1;
        return 'lg';
      },
    };

    expect(
      resolveClasses(
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

  test('partial process without env records without throwing', () => {
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
