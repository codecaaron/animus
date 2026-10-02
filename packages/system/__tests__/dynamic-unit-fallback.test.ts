import { describe, expect, test } from 'vitest';

import {
  type DynamicPropConfig,
  resolveClasses,
  resolveValue,
} from '../src/runtime/resolveClasses';

const config = { systemPropNames: ['lineHeight', 'width', 'mx'] };

/** A dynamic prop value as authored on a component: one scalar, or a
 *  breakpoint-keyed responsive map of them. */
type DynamicPropValue = string | number | Record<string, string | number>;

const styleFor = (
  props: Record<string, DynamicPropValue>,
  dynamicPropConfig: DynamicPropConfig
) =>
  resolveClasses('animus-U', props, config, undefined, dynamicPropConfig)
    .dynamicStyle;

const entry = (
  overrides: Partial<DynamicPropConfig[string]>
): DynamicPropConfig[string] => ({
  varName: '--animus-x',
  slotClass: 'animus-dyn-x',
  ...overrides,
});

describe('negative scale values', () => {
  const margin = entry({
    property: 'marginTop',
    negative: true,
    scaleValues: { 0: '0', 4: '1rem', 40: 'var(--space-40)', '-4': '2rem' },
  });

  test('negates the token reference and preserves an exact authored key', () => {
    expect(resolveValue(-40, margin)).toBe('calc(var(--space-40) * -1)');
    expect(resolveValue(-4, margin)).toBe('2rem');
    expect(resolveValue(0, margin)).toBe('0');
  });

  test('requires negative admission; a loose scale keeps raw misses', () => {
    expect(resolveValue(-40, { ...margin, negative: false })).toBe('-40px');
    expect(resolveValue(17, margin)).toBe('17px');
    expect(resolveValue(-17, margin)).toBe('-17px');
  });

  test('passes numeric inline tokens to the transform before negating', () => {
    const insetEntry = entry({
      property: 'inset',
      scaleValues: { half: 0.5, 1: 0.5 },
      negative: true,
      transform: (value) => {
        expect(value).toBe(0.5);
        return `${Number(value) * 100}%`;
      },
    });
    expect(resolveValue('half', insetEntry)).toBe('50%');
    expect(resolveValue(-1, insetEntry)).toBe('-50%');
  });

  test('applies units to numeric transform results before negating', () => {
    const marginEntry = entry({
      property: 'margin',
      properties: ['marginLeft', 'marginRight'],
      scaleValues: { 1: 0.5 },
      negative: true,
      transform: (value) => Number(value) * 8,
    });
    expect(resolveValue(1, marginEntry)).toBe('4px');
    expect(resolveValue(-1, marginEntry)).toBe('-4px');
    expect(
      resolveValue(-1, {
        ...marginEntry,
        properties: ['lineHeight', 'fontSize'],
      })
    ).toBe('-4');
  });

  test('resolves negative values in each responsive slot', () => {
    const result = resolveClasses(
      'animus-Box',
      { mt: { _: -40, md: -4 } },
      { systemPropNames: ['mt'] },
      undefined,
      { mt: margin }
    );
    expect(result.dynamicStyle).toEqual({
      '--animus-x': 'calc(var(--space-40) * -1)',
      '--animus-x-md': '2rem',
    });
  });
});

describe('dynamic prop unit fallback', () => {
  test('numeric value on a unitless property stays unit-less', () => {
    expect(
      styleFor(
        { lineHeight: 2 },
        {
          lineHeight: entry({
            varName: '--animus-line-height',
            slotClass: 'animus-dyn-line-height',
            property: 'lineHeight',
          }),
        }
      )
    ).toEqual({ '--animus-line-height': '2' });
  });

  test('numeric value on a length property gains px', () => {
    expect(
      styleFor(
        { width: 12 },
        {
          width: entry({
            varName: '--animus-width',
            slotClass: 'animus-dyn-width',
            property: 'width',
          }),
        }
      )
    ).toEqual({ '--animus-width': '12px' });
  });

  test('kebab-case property spelling resolves identically', () => {
    expect(
      styleFor(
        { lineHeight: 2 },
        {
          lineHeight: entry({
            varName: '--animus-line-height',
            slotClass: 'animus-dyn-line-height',
            property: 'line-height',
          }),
        }
      )
    ).toEqual({ '--animus-line-height': '2' });
  });

  test('responsive values apply the property decision per breakpoint', () => {
    expect(
      styleFor(
        { lineHeight: { _: 2, md: 3 } },
        {
          lineHeight: entry({
            varName: '--animus-line-height',
            slotClass: 'animus-dyn-line-height',
            property: 'lineHeight',
          }),
        }
      )
    ).toEqual({
      '--animus-line-height': '2',
      '--animus-line-height-md': '3',
    });
  });

  test('member properties decide for a multi-property prop', () => {
    expect(
      styleFor(
        { mx: 4 },
        {
          mx: entry({
            varName: '--animus-mx',
            slotClass: 'animus-dyn-mx',
            property: 'margin',
            properties: ['marginLeft', 'marginRight'],
          }),
        }
      )
    ).toEqual({ '--animus-mx': '4px' });
  });

  test('a mixed member set drops px rather than mangle the unitless member', () => {
    expect(
      styleFor(
        { mx: 2 },
        {
          mx: entry({
            varName: '--animus-mx',
            slotClass: 'animus-dyn-mx',
            property: 'font',
            properties: ['lineHeight', 'fontSize'],
          }),
        }
      )
    ).toEqual({ '--animus-mx': '2' });
  });

  test('a config without property keeps the pre-existing px fallback', () => {
    expect(
      styleFor(
        { lineHeight: 2 },
        {
          lineHeight: entry({
            varName: '--animus-line-height',
            slotClass: 'animus-dyn-line-height',
          }),
        }
      )
    ).toEqual({ '--animus-line-height': '2px' });
  });

  test('scale hits are emitted verbatim, unit fallback untouched', () => {
    expect(
      styleFor(
        { width: 'sm' },
        {
          width: entry({
            varName: '--animus-width',
            slotClass: 'animus-dyn-width',
            property: 'width',
            scaleValues: { sm: '4rem' },
          }),
        }
      )
    ).toEqual({ '--animus-width': '4rem' });
  });

  test('the per-component custom config resolves by the same rule', () => {
    const resolution = resolveClasses(
      'animus-U',
      { lineHeight: 2 },
      {
        ...config,
        customDynamicConfig: {
          lineHeight: entry({
            varName: '--animus-line-height',
            slotClass: 'animus-dyn-abc-line-height',
            property: 'lineHeight',
          }),
        },
      }
    );
    expect(resolution.dynamicStyle).toEqual({ '--animus-line-height': '2' });
  });
});
