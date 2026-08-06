import { describe, expect, test } from 'vitest';

import { buildDynamicPropConfig } from '../pipeline/dynamic-prop-config';

/**
 * The manifest's `dynamic_props` block is serialized from the Rust
 * `DynamicPropMeta` with `serde(rename_all = "camelCase")`
 * (crates/extract-v2/src/dynamic_meta.rs), so the fields arrive camelCase;
 * the snake_case spelling is the older hand-written/v1-era shape and is still
 * accepted.
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

  test('a meta carrying neither spelling fails loudly', () => {
    // A serde rename on DynamicPropMeta has to surface as a CI failure: the
    // silent version of this shipped a config of empty entries.
    expect(() =>
      buildDynamicPropConfig({
        lineHeight: { property: 'lineHeight' },
      })
    ).toThrow(/lineHeight/);
    expect(() =>
      buildDynamicPropConfig({ lineHeight: { property: 'lineHeight' } })
    ).toThrow(/varName\/slotClass.*var_name\/slot_class/s);
  });

  test('still reads the snake_case meta spelling', () => {
    expect(
      buildDynamicPropConfig({
        color: {
          var_name: '--anm-color',
          slot_class: 'anm-color-slot',
          property: 'color',
          transform_name: 'toColor',
          scale_values: { primary: '#00f' },
        },
      }).color
    ).toEqual({
      varName: '--anm-color',
      slotClass: 'anm-color-slot',
      property: 'color',
      transformName: 'toColor',
      scaleValues: { primary: '#00f' },
    });
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
  const config = buildDynamicPropConfig(engineManifestDynamicProps);

  test('every entry is populated — no entry may resolve to {}', () => {
    expect(Object.keys(config)).toEqual(['p', 'mx', 'lineHeight']);
    for (const [propName, entry] of Object.entries(config)) {
      expect(entry.varName, propName).toMatch(/^--animus-/);
      expect(entry.slotClass, propName).toMatch(/^animus-dyn-/);
      expect(typeof entry.property, propName).toBe('string');
      expect(entry.property?.length, propName).toBeGreaterThan(0);
    }
  });

  test('the runtime receives the CSS property that decides unit fallback', () => {
    expect(config.lineHeight.property).toBe('lineHeight');
    expect(config.mx.properties).toEqual(['marginLeft', 'marginRight']);
    expect(config.p.properties).toBeUndefined();
  });

  test('null transforms and empty scales are omitted, not emitted as null', () => {
    expect(JSON.stringify(config.p)).toBe(
      '{"varName":"--animus-p","slotClass":"animus-dyn-p","property":"padding"}'
    );
  });
});
