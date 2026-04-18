import { describe, expect, test } from 'bun:test';

import { SHORTHAND_PROPERTIES, UNITLESS_PROPERTIES } from '../src';

describe('UNITLESS_PROPERTIES', () => {
  test('contains 45 properties', () => {
    expect(UNITLESS_PROPERTIES.size).toBe(45);
  });

  test('all entries are kebab-case', () => {
    for (const prop of UNITLESS_PROPERTIES) {
      expect(prop).not.toMatch(/[A-Z]/);
    }
  });

  test('includes standard unitless properties', () => {
    expect(UNITLESS_PROPERTIES.has('opacity')).toBe(true);
    expect(UNITLESS_PROPERTIES.has('z-index')).toBe(true);
    expect(UNITLESS_PROPERTIES.has('font-weight')).toBe(true);
    expect(UNITLESS_PROPERTIES.has('line-height')).toBe(true);
    expect(UNITLESS_PROPERTIES.has('flex')).toBe(true);
  });

  test('includes modern unitless properties', () => {
    expect(UNITLESS_PROPERTIES.has('aspect-ratio')).toBe(true);
    expect(UNITLESS_PROPERTIES.has('scale')).toBe(true);
  });

  test('includes legacy flexbox properties', () => {
    expect(UNITLESS_PROPERTIES.has('box-flex')).toBe(true);
    expect(UNITLESS_PROPERTIES.has('box-flex-group')).toBe(true);
    expect(UNITLESS_PROPERTIES.has('box-ordinal-group')).toBe(true);
    expect(UNITLESS_PROPERTIES.has('flex-order')).toBe(true);
  });

  test('excludes length properties', () => {
    expect(UNITLESS_PROPERTIES.has('padding')).toBe(false);
    expect(UNITLESS_PROPERTIES.has('margin')).toBe(false);
    expect(UNITLESS_PROPERTIES.has('width')).toBe(false);
  });
});

describe('SHORTHAND_PROPERTIES', () => {
  test('has no duplicate entries', () => {
    const unique = new Set(SHORTHAND_PROPERTIES);
    expect(unique.size).toBe(SHORTHAND_PROPERTIES.length);
  });

  test('all entries are camelCase', () => {
    for (const prop of SHORTHAND_PROPERTIES) {
      expect(prop).not.toMatch(/^[A-Z]/);
      expect(prop).not.toMatch(/-/);
    }
  });

  test('includes standard shorthands', () => {
    expect(SHORTHAND_PROPERTIES).toContain('border');
    expect(SHORTHAND_PROPERTIES).toContain('margin');
    expect(SHORTHAND_PROPERTIES).toContain('padding');
    expect(SHORTHAND_PROPERTIES).toContain('flex');
    expect(SHORTHAND_PROPERTIES).toContain('grid');
    expect(SHORTHAND_PROPERTIES).toContain('gap');
  });
});
