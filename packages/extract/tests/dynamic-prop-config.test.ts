import { describe, expect, test } from 'vitest';

import { buildDynamicPropConfig } from '../pipeline/dynamic-prop-config';

import type { DynamicPropMeta } from '../pipeline/dynamic-prop-config';

/**
 * The manifest's `dynamic_props` block is serialized from the Rust
 * `DynamicPropMeta` with `serde(rename_all = "camelCase")`
 * (crates/extract-v2/src/dynamic_meta.rs), so camelCase is the only spelling
 * the builder reads.
 */
describe('buildDynamicPropConfig', () => {
  test('carries the CSS property from a camelCase manifest meta', () => {
    expect(
      buildDynamicPropConfig({
        lineHeight: {
          varName: '--animus-line-height',
          slotClass: 'animus-dyn-line-height',
          property: 'lineHeight',
        },
      })
    ).toEqual({
      lineHeight: {
        varName: '--animus-line-height',
        slotClass: 'animus-dyn-line-height',
        property: 'lineHeight',
      },
    });
  });

  test('carries member properties for a multi-property prop', () => {
    expect(
      buildDynamicPropConfig({
        mx: {
          varName: '--animus-mx',
          slotClass: 'animus-dyn-mx',
          property: 'margin',
          properties: ['marginLeft', 'marginRight'],
        },
      }).mx
    ).toEqual({
      varName: '--animus-mx',
      slotClass: 'animus-dyn-mx',
      property: 'margin',
      properties: ['marginLeft', 'marginRight'],
    });
  });

  test('emits transform name and scale values when present', () => {
    expect(
      buildDynamicPropConfig({
        color: {
          varName: '--animus-color',
          slotClass: 'animus-dyn-color',
          property: 'color',
          transformName: 'toColor',
          scaleValues: { primary: '#00f' },
        },
      }).color
    ).toEqual({
      varName: '--animus-color',
      slotClass: 'animus-dyn-color',
      property: 'color',
      transformName: 'toColor',
      scaleValues: { primary: '#00f' },
    });
  });

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
    // A serde rename on DynamicPropMeta has to surface as a CI failure: the
    // silent version of this shipped a config of empty entries.
    const build = () =>
      buildDynamicPropConfig({
        lineHeight: { property: 'lineHeight' } as unknown as DynamicPropMeta,
      });
    expect(build).toThrow(/lineHeight/);
    expect(build).toThrow(/varName and slotClass/);
  });
});

/**
 * The hand-written fixtures above are the shape this builder was *written*
 * for; this block is the shape the engine actually hands it. Fields mirror
 * the manifest's `dynamic_props` block verbatim — camelCase keys, `null`
 * transforms, an empty `scaleValues` map, `properties` omitted when the prop
 * declares one property — as asserted for real pipeline runs in
 * packages/_integration/__tests__/manifest-shape.test.ts ('dynamic prop
 * entries carry required metadata') and in the Rust manifest test in
 * crates/extract-v2/src/engine.rs.
 */
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
