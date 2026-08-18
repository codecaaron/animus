import { describe, expect, it } from 'vitest';

import {
  asEvidenceId,
  asWorldId,
  canonicalJson,
  stableHash,
} from '../src/core/identity';

describe('canonicalJson', () => {
  it('is independent of key insertion order, at every depth', () => {
    const a = { b: 1, a: { z: [1, 2], y: 'k' } };
    const b = { a: { y: 'k', z: [1, 2] }, b: 1 };

    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(canonicalJson(a)).toBe('{"a":{"y":"k","z":[1,2]},"b":1}');
  });

  it('preserves array order (arrays are sequences, not sets)', () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });

  it('omits undefined object properties', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(canonicalJson({ a: 1 })).toBe(canonicalJson({ a: 1, b: undefined }));
  });

  it('throws loudly on values with no exact canonical form', () => {
    expect(() => canonicalJson(Number.NaN)).toThrow(TypeError);
    expect(() => canonicalJson({ x: Number.POSITIVE_INFINITY })).toThrow(
      /non-finite/
    );
    expect(() => canonicalJson({ f: () => 1 })).toThrow(/unsupported function/);
    expect(() => canonicalJson({ n: 1n })).toThrow(/unsupported bigint/);
    expect(() => canonicalJson({ s: Symbol('s') })).toThrow(
      /unsupported symbol/
    );
  });

  it('throws on undefined outside object-property position', () => {
    expect(() => canonicalJson(undefined)).toThrow(/undefined/);
    expect(() => canonicalJson([1, undefined])).toThrow(/undefined/);
  });

  it('throws on non-plain objects rather than silently emitting {}', () => {
    expect(() => canonicalJson(new Map([['a', 1]]))).toThrow(/non-plain/);
    expect(() => canonicalJson({ at: new Set([1]) })).toThrow(/non-plain/);
  });

  it('accepts null-prototype records', () => {
    const record: Record<string, number> = Object.create(null);
    record.a = 1;
    expect(canonicalJson(record)).toBe('{"a":1}');
  });

  it('normalises -0 to 0 — numerically equal values hash equal', () => {
    expect(canonicalJson({ n: -0 })).toBe(canonicalJson({ n: 0 }));
  });
});

describe('stableHash', () => {
  it('matches a pinned literal — algorithm drift must fail the suite', () => {
    const fixed = { b: 1, a: [3, { z: true, y: null }], c: 'x' };
    expect(stableHash(fixed)).toBe('30cfca03aef7d141');
    expect(stableHash('oracle')).toBe('f131a0db68862d39');
  });

  it('agrees with canonicalJson on content equality', () => {
    expect(stableHash({ a: 1, b: 2 })).toBe(stableHash({ b: 2, a: 1 }));
    expect(stableHash({ a: 1 })).not.toBe(stableHash({ a: 2 }));
  });
});

describe('brand casts', () => {
  it('are runtime-identity — brands exist only in the type system', () => {
    expect(asWorldId('w1')).toBe('w1');
    expect(asEvidenceId('e1')).toBe('e1');
  });
});
