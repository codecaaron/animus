import { describe, expect, test } from 'vitest';

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

  test('includes spec-named unitless members (standard, modern, legacy flexbox)', () => {
    // openspec/specs/css-property-data scenarios: 'Contains standard unitless
    // properties', 'Contains modern unitless properties', 'Contains legacy
    // flexbox unitless properties'.
    const required = [
      'opacity',
      'z-index',
      'font-weight',
      'line-height',
      'flex',
      'aspect-ratio',
      'scale',
      'box-flex',
      'box-flex-group',
      'box-ordinal-group',
      'flex-order',
    ];
    expect(required.filter((p) => !UNITLESS_PROPERTIES.has(p))).toEqual([]);
  });

  test('excludes length properties', () => {
    const lengths = ['padding', 'margin', 'width'];
    expect(lengths.filter((p) => UNITLESS_PROPERTIES.has(p))).toEqual([]);
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
