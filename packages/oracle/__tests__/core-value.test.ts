import { describe, expect, it } from 'vitest';

import { asObligationId } from '../src/core/identity';
import { and, eq, TRUE } from '../src/core/predicate';
import {
  describeValue,
  exact,
  finiteSet,
  piecewise,
  precisionRank,
  unknownValue,
  valueEquals,
} from '../src/core/value';

import type { AbstractValue } from '../src/core/value';

const obligation = asObligationId('ob-1');

describe('finiteSet', () => {
  it('dedupes by canonical form and collapses a singleton to exact', () => {
    expect(finiteSet(['12px', '12px'])).toEqual(exact('12px'));
    expect(finiteSet([{ a: 1 }, { a: 1 }])).toEqual(exact({ a: 1 }));
    expect(finiteSet(['12px', '16px', '12px'])).toEqual({
      kind: 'finite-set',
      values: ['12px', '16px'],
    });
  });

  it('keeps an empty set as the bottom of the lattice', () => {
    expect(finiteSet([])).toEqual({ kind: 'finite-set', values: [] });
  });
});

describe('piecewise', () => {
  const dark = eq('mode', 'dark');
  const light = eq('mode', 'light');
  const compact = eq('density', 'compact');

  it('collapses a single unconditional case to its value', () => {
    expect(piecewise([{ guard: TRUE, value: exact('12px') }])).toEqual(
      exact('12px')
    );
  });

  it('keeps a single guarded case', () => {
    expect(piecewise([{ guard: dark, value: exact('12px') }])).toEqual({
      kind: 'piecewise',
      cases: [{ guard: dark, value: exact('12px') }],
    });
  });

  it('merges adjacent cases with equal values by disjoining their guards', () => {
    expect(
      piecewise([
        { guard: dark, value: exact('12px') },
        { guard: light, value: exact('12px') },
        { guard: compact, value: exact('8px') },
      ])
    ).toEqual({
      kind: 'piecewise',
      cases: [
        {
          guard: { kind: 'or', operands: [dark, light] },
          value: exact('12px'),
        },
        { guard: compact, value: exact('8px') },
      ],
    });
  });

  it('merges into an unconditional value when the union covers everything', () => {
    expect(
      piecewise([
        { guard: dark, value: exact('12px') },
        { guard: TRUE, value: exact('12px') },
      ])
    ).toEqual(exact('12px'));
  });

  it('does not reorder to merge non-adjacent equal values', () => {
    const result = piecewise([
      { guard: dark, value: exact('12px') },
      { guard: compact, value: exact('8px') },
      { guard: light, value: exact('12px') },
    ]);
    expect(result.kind).toBe('piecewise');
    expect(result.kind === 'piecewise' && result.cases).toHaveLength(3);
  });

  it('refuses an empty case analysis', () => {
    expect(() => piecewise([])).toThrow(/at least one case/);
  });
});

describe('valueEquals', () => {
  it('is structural and key-order independent', () => {
    expect(valueEquals(exact('12px'), exact('12px'))).toBe(true);
    expect(valueEquals(exact('12px'), exact('16px'))).toBe(false);
    expect(
      valueEquals(
        { kind: 'interval', min: 0, max: 10, unit: 'px' },
        { kind: 'interval', max: 10, min: 0, unit: 'px' }
      )
    ).toBe(true);
    expect(
      valueEquals(exact('12px'), { kind: 'finite-set', values: ['12px'] })
    ).toBe(false);
  });
});

describe('precisionRank', () => {
  it('orders the lattice for display only', () => {
    expect(precisionRank(exact(1))).toBe(5);
    expect(precisionRank({ kind: 'finite-set', values: [1, 2] })).toBe(4);
    expect(precisionRank({ kind: 'interval', min: 0, max: 1 })).toBe(3);
    expect(precisionRank({ kind: 'symbolic', expression: 'a', refs: [] })).toBe(
      2
    );
    expect(precisionRank(unknownValue(obligation))).toBe(0);
  });

  it('takes the weakest case of a piecewise value', () => {
    const value: AbstractValue<number> = {
      kind: 'piecewise',
      cases: [
        { guard: eq('mode', 'dark'), value: exact(1) },
        { guard: eq('mode', 'light'), value: unknownValue(obligation) },
      ],
    };
    expect(precisionRank(value)).toBe(0);
  });
});

describe('describeValue', () => {
  it('renders each lattice member', () => {
    expect(describeValue(exact('12px'))).toBe('12px');
    expect(describeValue(exact(12))).toBe('12');
    expect(describeValue(finiteSet(['12px', '16px']))).toBe(
      'one of {12px, 16px}'
    );
    expect(
      describeValue({ kind: 'interval', min: 0, max: 10, unit: 'px' })
    ).toBe('[0, 10]px');
    expect(
      describeValue({
        kind: 'symbolic',
        expression: 'calc(a + b)',
        refs: ['a'],
      })
    ).toBe('calc(a + b) (refs: a)');
    expect(describeValue(unknownValue(obligation))).toBe('unknown(ob-1)');
    expect(
      describeValue(
        piecewise([
          {
            guard: and(eq('mode', 'dark'), eq('density', 'compact')),
            value: exact('8px'),
          },
          { guard: eq('mode', 'light'), value: exact('12px') },
        ])
      )
    ).toBe(
      'when mode = dark ∧ density = compact: 8px | when mode = light: 12px'
    );
  });
});
