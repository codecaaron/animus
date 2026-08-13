import { describe, expect, it } from 'vitest';

import {
  and,
  collectCuts,
  describePredicate,
  eq,
  evalPredicate,
  FALSE,
  inSet,
  not,
  or,
  range,
  referencedDimensions,
  satisfiableOverDomain,
  TRUE,
} from '../src/core/predicate';

import type { Predicate } from '../src/core/predicate';
import type { ScenarioDomain } from '../src/core/scenario';

const point = { mode: 'dark', 'viewport.inline': 900, compact: true };

describe('evalPredicate', () => {
  it('decides the leaves', () => {
    expect(evalPredicate(TRUE, point)).toBe(true);
    expect(evalPredicate(FALSE, point)).toBe(false);
    expect(evalPredicate(eq('mode', 'dark'), point)).toBe(true);
    expect(evalPredicate(eq('mode', 'light'), point)).toBe(false);
    expect(evalPredicate(inSet('mode', ['dark', 'dim']), point)).toBe(true);
    expect(evalPredicate(inSet('mode', ['light']), point)).toBe(false);
    expect(evalPredicate(range('viewport.inline', { min: 768 }), point)).toBe(
      true
    );
    expect(evalPredicate(range('viewport.inline', { max: 768 }), point)).toBe(
      false
    );
  });

  it('honours bound inclusivity', () => {
    const at = { x: 768 };
    expect(evalPredicate(range('x', { min: 768 }), at)).toBe(true);
    expect(
      evalPredicate(range('x', { min: 768, minInclusive: false }), at)
    ).toBe(false);
    expect(evalPredicate(range('x', { max: 768 }), at)).toBe(true);
    expect(
      evalPredicate(range('x', { max: 768, maxInclusive: false }), at)
    ).toBe(false);
  });

  it('evaluates a leaf on an unbound dimension to FALSE (scoped proofs)', () => {
    expect(evalPredicate(eq('theme', 'brand'), point)).toBe(false);
    expect(evalPredicate(inSet('theme', ['brand']), point)).toBe(false);
    expect(evalPredicate(range('density', { min: 0 }), point)).toBe(false);
    // The consequence engines must surface as an assumption: the negation of
    // an inactive condition is vacuously true.
    expect(evalPredicate(not(eq('theme', 'brand')), point)).toBe(true);
  });

  it('evaluates a range leaf on a non-numeric binding to FALSE', () => {
    expect(evalPredicate(range('mode', { min: 0 }), point)).toBe(false);
  });

  it('composes', () => {
    expect(
      evalPredicate(and(eq('mode', 'dark'), eq('compact', true)), point)
    ).toBe(true);
    expect(
      evalPredicate(or(eq('mode', 'light'), eq('compact', true)), point)
    ).toBe(true);
    expect(evalPredicate(not(eq('mode', 'dark')), point)).toBe(false);
  });
});

describe('constructor normalisation', () => {
  it('flattens nested and/or and drops neutral elements', () => {
    const flattened = and(and(eq('a', 1), eq('b', 2)), eq('c', 3));
    expect(flattened).toEqual({
      kind: 'and',
      operands: [eq('a', 1), eq('b', 2), eq('c', 3)],
    });

    expect(and(TRUE, eq('a', 1), TRUE)).toEqual(eq('a', 1));
    expect(or(FALSE, eq('a', 1))).toEqual(eq('a', 1));
    expect(or(or(eq('a', 1), eq('b', 2)), eq('c', 3))).toEqual({
      kind: 'or',
      operands: [eq('a', 1), eq('b', 2), eq('c', 3)],
    });
  });

  it('collapses to TRUE/FALSE where decidable', () => {
    expect(and()).toEqual(TRUE);
    expect(or()).toEqual(FALSE);
    expect(and(eq('a', 1), FALSE)).toEqual(FALSE);
    expect(or(eq('a', 1), TRUE)).toEqual(TRUE);
    expect(not(TRUE)).toEqual(FALSE);
    expect(not(FALSE)).toEqual(TRUE);
    expect(not(not(eq('a', 1)))).toEqual(eq('a', 1));
  });

  it('deduplicates operands so equal guards share a normal form', () => {
    expect(and(eq('a', 1), eq('a', 1))).toEqual(eq('a', 1));
    expect(or(eq('a', 1), eq('a', 1), eq('b', 2))).toEqual({
      kind: 'or',
      operands: [eq('a', 1), eq('b', 2)],
    });
  });

  it('normalises inSet: dedupe, order, and the degenerate sizes', () => {
    expect(inSet('a', [])).toEqual(FALSE);
    expect(inSet('a', ['x', 'x'])).toEqual(eq('a', 'x'));
    expect(inSet('a', ['b', 'a', 'b'])).toEqual(inSet('a', ['a', 'b']));
    // 1 and '1' are distinct members, never merged.
    expect(inSet('a', [1, '1'])).toEqual({
      kind: 'in',
      dim: 'a',
      values: [1, '1'],
    });
  });

  it('normalises impossible ranges to FALSE and writes inclusivity out', () => {
    expect(range('x', { min: 10, max: 1 })).toEqual(FALSE);
    expect(range('x', { min: 5, max: 5, maxInclusive: false })).toEqual(FALSE);
    expect(range('x', { min: 5, max: 5 })).toEqual({
      kind: 'range',
      dim: 'x',
      min: 5,
      minInclusive: true,
      max: 5,
      maxInclusive: true,
    });
    expect(range('x', { min: 1 })).toEqual({
      kind: 'range',
      dim: 'x',
      min: 1,
      minInclusive: true,
    });
  });
});

describe('referencedDimensions', () => {
  it('is sorted and unique across the whole tree', () => {
    const p = and(
      eq('mode', 'dark'),
      or(range('viewport.inline', { min: 768 }), eq('mode', 'light')),
      not(inSet('variant:Box:size', ['sm']))
    );
    expect(referencedDimensions(p)).toEqual([
      'mode',
      'variant:Box:size',
      'viewport.inline',
    ]);
    expect(referencedDimensions(TRUE)).toEqual([]);
  });
});

describe('collectCuts', () => {
  it('collects range bounds and numeric eq/in values, sorted and deduped', () => {
    const p = and(
      range('viewport.inline', { min: 768, max: 1024 }),
      range('viewport.inline', { min: 768 }),
      eq('viewport.inline', 1440),
      inSet('density', [1, 2, 2]),
      eq('mode', 'dark')
    );
    expect(collectCuts(p)).toEqual({
      density: [1, 2],
      'viewport.inline': [768, 1024, 1440],
    });
  });

  it('collects numeric eq/in values unconditionally — callers filter', () => {
    expect(collectCuts(eq('variant:Box:cols', 3))).toEqual({
      'variant:Box:cols': [3],
    });
    expect(collectCuts(eq('mode', 'dark'))).toEqual({});
  });
});

describe('satisfiableOverDomain', () => {
  const domain: ScenarioDomain = {
    mode: { kind: 'finite', values: ['light', 'dark'] },
    'viewport.inline': { kind: 'interval', min: 0, max: 1920 },
  };
  const cuts = { 'viewport.inline': [768] };

  it('finds a satisfying cell representative', () => {
    expect(
      satisfiableOverDomain(
        and(eq('mode', 'dark'), range('viewport.inline', { min: 768 })),
        domain,
        cuts
      )
    ).toBe(true);
  });

  it('reports unsatisfiable guards', () => {
    expect(satisfiableOverDomain(eq('mode', 'sepia'), domain, cuts)).toBe(
      false
    );
    expect(
      satisfiableOverDomain(
        and(eq('mode', 'dark'), eq('mode', 'light')),
        domain,
        cuts
      )
    ).toBe(false);
  });

  it('treats guards over undeclared dimensions as unsatisfiable', () => {
    expect(satisfiableOverDomain(eq('density', 2), domain, cuts)).toBe(false);
  });
});

describe('describePredicate', () => {
  it('renders compact human strings', () => {
    const p: Predicate = and(
      eq('mode', 'dark'),
      range('viewport.inline', { min: 768 })
    );
    expect(describePredicate(p)).toBe('mode = dark ∧ viewport.inline ≥ 768');
    expect(describePredicate(TRUE)).toBe('always');
    expect(describePredicate(FALSE)).toBe('never');
    expect(describePredicate(inSet('mode', ['dark', 'dim']))).toBe(
      'mode ∈ {dark, dim}'
    );
    expect(
      describePredicate(range('x', { min: 0, max: 10, maxInclusive: false }))
    ).toBe('0 ≤ x < 10');
    expect(describePredicate(not(eq('mode', 'dark')))).toBe('¬mode = dark');
    expect(describePredicate(and(eq('a', 1), or(eq('b', 2), eq('c', 3))))).toBe(
      'a = 1 ∧ (b = 2 ∨ c = 3)'
    );
  });
});
