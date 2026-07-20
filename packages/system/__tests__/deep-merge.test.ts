import { describe, expect, it } from 'vitest';

import { deepMerge } from '../src/utils/deepMerge';

/**
 * Boundary tests documenting the CURRENT behavior of deepMerge.
 * These are characterization tests — they assert what the implementation
 * actually does today, not what it "should" do. Do not change semantics
 * to make these pass; change these when the semantics intentionally change.
 */
describe('deepMerge (current behavior)', () => {
  describe('nested object merge recursion', () => {
    it('recursively merges nested plain objects', () => {
      const target = { a: { x: 1, y: 2 }, top: 'keep' };
      const source = { a: { y: 20, z: 30 } };

      expect(deepMerge(target, source)).toEqual({
        a: { x: 1, y: 20, z: 30 },
        top: 'keep',
      });
    });

    it('merges multiple levels deep', () => {
      const target = { a: { b: { c: 1, d: 2 } } };
      const source = { a: { b: { d: 20, e: 30 } } };

      expect(deepMerge(target, source)).toEqual({
        a: { b: { c: 1, d: 20, e: 30 } },
      });
    });
  });

  describe('arrays REPLACE rather than merge', () => {
    it('replaces an array with the source array (no element merge)', () => {
      const target = { list: [1, 2, 3] };
      const source = { list: [9] };

      expect(deepMerge(target, source)).toEqual({ list: [9] });
    });

    it('replaces even when only the target value is an array', () => {
      const target = { list: [1, 2] };
      const source = { list: { 0: 'a' } };

      // target array is not mergeable, so source object wins wholesale
      expect(deepMerge(target, source)).toEqual({ list: { 0: 'a' } });
    });

    it('replaces even when only the source value is an array', () => {
      const target = { list: { 0: 'a' } };
      const source = { list: [1, 2] };

      expect(deepMerge(target, source)).toEqual({ list: [1, 2] });
    });
  });

  describe('null / undefined source values', () => {
    it('overwrites with a null source value', () => {
      const target = { a: { nested: true } };
      const source = { a: null };

      expect(deepMerge(target, source)).toEqual({ a: null });
    });

    it('overwrites with an undefined source value (own enumerable key)', () => {
      const target = { a: 1, b: 2 };
      const source: { a: number | undefined } = { a: undefined };

      const result = deepMerge(target, source);
      expect(result).toHaveProperty('a', undefined);
      expect(result.b).toBe(2);
    });
  });

  describe('scalar-over-object and object-over-scalar', () => {
    it('scalar source replaces an object target', () => {
      const target = { a: { nested: 1 } };
      const source = { a: 5 };

      expect(deepMerge(target, source)).toEqual({ a: 5 });
    });

    it('object source replaces a scalar target', () => {
      const target = { a: 5 };
      const source = { a: { nested: 1 } };

      expect(deepMerge(target, source)).toEqual({ a: { nested: 1 } });
    });
  });

  describe('empty objects', () => {
    it('empty source object leaves the target object untouched', () => {
      const target = { a: { x: 1 } };
      const source = { a: {} };

      expect(deepMerge(target, source)).toEqual({ a: { x: 1 } });
    });

    it('empty target object receives all source keys', () => {
      const target = { a: {} };
      const source = { a: { x: 1 } };

      expect(deepMerge(target, source)).toEqual({ a: { x: 1 } });
    });

    it('empty top-level source returns a copy of the target', () => {
      const target = { a: 1, b: 2 };
      const source = {};

      const result = deepMerge(target, source);
      expect(result).toEqual({ a: 1, b: 2 });
      expect(result).not.toBe(target);
    });
  });

  describe('mutation semantics', () => {
    it('does not mutate the target (top-level)', () => {
      const target = { a: 1, nested: { x: 1 } };
      const source = { a: 2, nested: { y: 2 } };

      deepMerge(target, source);

      expect(target).toEqual({ a: 1, nested: { x: 1 } });
    });

    it('does not mutate nested target objects', () => {
      const nested = { x: 1 };
      const target = { nested };
      const source = { nested: { y: 2 } };

      const result = deepMerge(target, source);

      // original nested object is left intact...
      expect(nested).toEqual({ x: 1 });
      // ...and the merged result is a fresh object, not the same reference
      expect(result.nested).not.toBe(nested);
      expect(result.nested).toEqual({ x: 1, y: 2 });
    });

    it('returns a new top-level object distinct from target and source', () => {
      const target = { a: 1 };
      const source = { b: 2 };

      const result = deepMerge(target, source);

      expect(result).not.toBe(target);
      expect(result).not.toBe(source);
      expect(result).toEqual({ a: 1, b: 2 });
    });

    it('shares the source reference for non-mergeable (replaced) values', () => {
      const shared = { deep: true };
      const target = { a: 1 };
      const source = { a: shared };

      const result = deepMerge(target, source);

      // scalar target replaced by object source: assigned by reference
      expect(result.a).toBe(shared);
    });
  });
});
