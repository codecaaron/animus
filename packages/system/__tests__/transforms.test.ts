import { describe, expect, it } from 'vitest';

import { borderShorthand } from '../src/transforms/border';
import { percentageOrAbsolute, size } from '../src/transforms/size';

/**
 * Characterization tests for the size + border transform surfaces.
 *
 * These pin ACTUAL observed behavior (not desired behavior) of two pure
 * transform callbacks that had no direct coverage:
 *   - `percentageOrAbsolute` (exported helper, never called by the transform)
 *   - the `size` transform callback (calc passthrough, regex parse, toSize)
 *   - the `borderShorthand` transform callback
 *
 * Transforms are plain callables (see createTransform.ts: the returned
 * NamedTransform IS the callback wrapper), so they are invoked directly.
 */

describe('percentageOrAbsolute', () => {
  it('returns the number 0 (not a string) for 0', () => {
    const result = percentageOrAbsolute(0);
    expect(result).toBe(0);
    expect(typeof result).toBe('number');
  });

  it.each([
    [0.5, '50%'],
    [0.25, '25%'],
    [0.75, '75%'],
    [1, '100%'], // boundary is inclusive (<= 1)
    [-0.5, '-50%'],
    [-1, '-100%'], // boundary is inclusive (>= -1)
  ] as const)(
    'treats magnitude <= 1 as a percentage: %p -> %p',
    (input, expected) => {
      expect(percentageOrAbsolute(input)).toBe(expected);
    }
  );

  it.each([
    [2, '2px'],
    [-2, '-2px'],
    [1.5, '1.5px'],
    [-1.5, '-1.5px'],
  ] as const)(
    'treats magnitude > 1 as absolute px: %p -> %p',
    (input, expected) => {
      expect(percentageOrAbsolute(input)).toBe(expected);
    }
  );
});

describe('size transform', () => {
  it('exposes its transformName', () => {
    expect(size.transformName).toBe('size');
  });

  describe('numeric input (same toSize semantics as percentageOrAbsolute)', () => {
    it('returns the number 0 (not a string) for 0', () => {
      const result = size(0);
      expect(result).toBe(0);
      expect(typeof result).toBe('number');
    });

    it.each([
      [0.5, '50%'],
      [0.25, '25%'],
      [1, '100%'],
      [-0.5, '-50%'],
      [-1, '-100%'],
    ] as const)('magnitude <= 1 -> percentage: %p -> %p', (input, expected) => {
      expect(size(input)).toBe(expected);
    });

    it.each([
      [2, '2px'],
      [-2, '-2px'],
      [1.5, '1.5px'],
    ] as const)('magnitude > 1 -> px: %p -> %p', (input, expected) => {
      expect(size(input)).toBe(expected);
    });
  });

  describe('calc() string passthrough', () => {
    it.each(['calc(100% - 10px)', 'calc(50vh + 2rem)'])(
      'returns calc strings unchanged: %p',
      (input) => {
        expect(size(input)).toBe(input);
      }
    );

    it('passes through any string merely CONTAINING "calc" (substring match)', () => {
      // Documents the .includes('calc') quirk: non-calc strings that happen
      // to contain the substring bypass the numeric parse entirely.
      expect(size('calculate-this')).toBe('calculate-this');
    });
  });

  describe('unitless numeric strings (run through toSize)', () => {
    it.each([
      ['10', '10px'], // > 1 -> px
      ['2', '2px'],
      ['1.5', '1.5px'],
      ['1', '100%'], // <= 1 -> percentage
      ['0.5', '50%'],
      ['-0.5', '-50%'],
    ] as const)('%p -> %p', (input, expected) => {
      expect(size(input)).toBe(expected);
    });

    it('returns the number 0 (not a string) for the string "0"', () => {
      const result = size('0');
      expect(result).toBe(0);
      expect(typeof result).toBe('number');
    });
  });

  describe('unit-bearing strings (unit preserved, NO percentage/px coercion)', () => {
    it.each([
      ['10px', '10px'],
      ['-10px', '-10px'],
      ['10%', '10%'],
      ['50%', '50%'],
      ['1.5rem', '1.5rem'],
      // Key distinction: a sub-1 magnitude WITH a unit is NOT converted to a
      // percentage — the unit branch keeps the raw number + unit.
      ['0.5rem', '0.5rem'],
    ] as const)('%p -> %p', (input, expected) => {
      expect(size(input)).toBe(expected);
    });
  });

  describe('non-numeric strings (no regex match -> passthrough)', () => {
    it.each(['auto', 'inherit', ''])('returns unchanged: %p', (input) => {
      expect(size(input)).toBe(input);
    });
  });
});

describe('borderShorthand transform', () => {
  it('exposes its transformName', () => {
    expect(borderShorthand.transformName).toBe('borderShorthand');
  });

  it.each([
    [1, '1px solid currentColor'],
    [0, '0px solid currentColor'],
    [-2, '-2px solid currentColor'],
    [1.5, '1.5px solid currentColor'],
    [4, '4px solid currentColor'],
  ] as const)(
    'composes a number into a "<n>px solid currentColor" shorthand: %p -> %p',
    (input, expected) => {
      expect(borderShorthand(input)).toBe(expected);
    }
  );

  it.each([
    '1px dashed red',
    'thin solid blue',
    'none',
    '2', // numeric STRING is passed through, NOT composed
    '',
  ])('passes non-number values through unchanged: %p', (input) => {
    expect(borderShorthand(input)).toBe(input);
  });
});
