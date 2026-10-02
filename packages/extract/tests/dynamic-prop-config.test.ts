import { createSystem, createTransform } from '@animus-ui/system';
import { layout } from '@animus-ui/system/groups';
import { describe, expect, test } from 'vitest';

import { buildDynamicPropConfig } from '../pipeline/dynamic-prop-config';
import { buildSystemPropsModule } from '../pipeline/system-props-module';

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
            transformId: 'toSpace@system.mx',
            scaleValues: { sm: '4px' },
            negative: true,
            strict: true,
            keywords: ['auto', 'inherit'],
          },
        })
      )
    ).toBe(
      '{"mx":{"varName":"--animus-mx","slotClass":"animus-dyn-mx","property":"margin",' +
        '"properties":["marginLeft","marginRight"],"transformName":"toSpace",' +
        '"transformId":"toSpace@system.mx","scaleValues":{"sm":"4px"},"negative":true,"strict":true,' +
        '"keywords":["auto","inherit"]}}'
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

async function evaluateTransforms(
  admittedTransforms: Record<string, string>
): Promise<Record<string, (value: string | number) => string | number>> {
  const source = buildSystemPropsModule({
    systemPropMapJson: '{}',
    groupRegistryJson: '{}',
    dynamicProps: {},
    admittedTransforms,
  });
  const { transforms } = await import(
    `data:text/javascript,${encodeURIComponent(source)}`
  );
  return transforms;
}

describe('buildSystemPropsModule transforms: the registry the runtime binds by transformId', () => {
  test('admitted configured transforms arrive as callables', async () => {
    const fraction = createTransform(
      'fraction',
      (value) => `${Number(value) * 50}%`
    );
    const config = createSystem()
      .addGroup('layout', {
        width: layout.width,
        gauge: { property: 'width', transform: fraction },
      })
      .build()
      .seal()
      .toConfig();

    const transforms = await evaluateTransforms(
      JSON.parse(config.transformSources)
    );
    const props = JSON.parse(config.propConfig);
    const width = transforms[props.width.transformId];
    const gauge = transforms[props.gauge.transformId];

    expect(width(0.375)).toBe('37.5%');
    expect(width('3rem')).toBe('3rem');
    expect(gauge(0.5)).toBe('25%');
  });

  test('a configured transform named size reaches runtime unchanged', async () => {
    const size = createTransform('size', (value) => `${Number(value) * 16}rem`);
    const config = createSystem()
      .addGroup('layout', { width: { property: 'width', transform: size } })
      .build()
      .seal()
      .toConfig();

    const transforms = await evaluateTransforms(
      JSON.parse(config.transformSources)
    );
    const { transformId } = JSON.parse(config.propConfig).width;

    expect(transforms[transformId](0.375)).toBe('6rem');
  });

  test('an entry that is not strict-mode module code is omitted, not fatal', async () => {
    const transforms = await evaluateTransforms({
      kept: '(v) => v',
      method: 'method(v) { return v; }',
      spliced: '(v) => v), (x',
      comment: '(v) => v // trailing',
      sloppy:
        'function anonymous(value\n) {\nvar interface = 1; return value + 010;\n}',
    });

    expect(Object.keys(transforms)).toEqual(['kept']);
  });

  test('no admitted transforms exports an empty registry', async () => {
    expect(await evaluateTransforms({})).toEqual({});
  });
});
