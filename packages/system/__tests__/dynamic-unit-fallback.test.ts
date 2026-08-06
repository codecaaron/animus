import { describe, expect, test } from 'vitest';

import {
  type DynamicPropConfig,
  resolveClasses,
} from '../src/runtime/resolveClasses';

const config = { systemPropNames: ['lineHeight', 'width', 'mx'] };

const styleFor = (
  props: Record<string, unknown>,
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
