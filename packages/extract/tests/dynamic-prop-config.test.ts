import { describe, expect, test } from 'vitest';

import { buildDynamicPropConfig } from '../pipeline/dynamic-prop-config';

import type { DynamicPropMeta } from '../pipeline/dynamic-prop-config';

describe('buildDynamicPropConfig', () => {
  test('omits absent property, empty properties, null transform, empty scales', () => {
    expect(
      JSON.stringify(
        buildDynamicPropConfig({
          p: {
            varName: '--animus-p',
            slotClass: 'animus-dyn-p',
            properties: [],
            transformName: null,
            scaleValues: {},
          },
        })
      )
    ).toBe('{"p":{"varName":"--animus-p","slotClass":"animus-dyn-p"}}');
  });

  test('field order is fixed — the emitted module text is a contract', () => {
    expect(
      JSON.stringify(
        buildDynamicPropConfig({
          mx: {
            varName: '--animus-mx',
            slotClass: 'animus-dyn-mx',
            property: 'margin',
            properties: ['marginLeft', 'marginRight'],
            transformName: 'toSpace',
            scaleValues: { sm: '4px' },
          },
        })
      )
    ).toBe(
      '{"mx":{"varName":"--animus-mx","slotClass":"animus-dyn-mx","property":"margin",' +
        '"properties":["marginLeft","marginRight"],"transformName":"toSpace",' +
        '"scaleValues":{"sm":"4px"}}}'
    );
  });

  test('a meta with no slot metadata fails loudly', () => {
    const renamedSlotFields: Partial<DynamicPropMeta> = {
      property: 'lineHeight',
    };
    const build = () =>
      buildDynamicPropConfig({
        // SAFETY: the assertion is the test — a meta violating
        // `DynamicPropMeta` must reach the builder's runtime guard.
        lineHeight: renamedSlotFields as DynamicPropMeta,
      });
    expect(build).toThrow(/lineHeight/);
    expect(build).toThrow(/varName and slotClass/);
  });
});

const engineManifestDynamicProps = {
  p: {
    varName: '--animus-p',
    slotClass: 'animus-dyn-p',
    property: 'padding',
    transformName: null,
    transformFnSource: null,
    scaleValues: {},
  },
  mx: {
    varName: '--animus-mx',
    slotClass: 'animus-dyn-mx',
    property: 'margin',
    properties: ['marginLeft', 'marginRight'],
    transformName: null,
    transformFnSource: null,
    scaleValues: {},
  },
  lineHeight: {
    varName: '--animus-line-height',
    slotClass: 'animus-dyn-line-height',
    property: 'lineHeight',
    transformName: null,
    transformFnSource: null,
    scaleValues: {},
  },
};

describe('buildDynamicPropConfig on an engine-shaped manifest block', () => {
  test('the whole config is what the runtime receives — every entry populated, the unit-fallback property carried, nulls and empties dropped', () => {
    expect(buildDynamicPropConfig(engineManifestDynamicProps)).toEqual({
      p: {
        varName: '--animus-p',
        slotClass: 'animus-dyn-p',
        property: 'padding',
      },
      mx: {
        varName: '--animus-mx',
        slotClass: 'animus-dyn-mx',
        property: 'margin',
        properties: ['marginLeft', 'marginRight'],
      },
      lineHeight: {
        varName: '--animus-line-height',
        slotClass: 'animus-dyn-line-height',
        property: 'lineHeight',
      },
    });
  });
});
