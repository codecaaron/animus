import { buildDynamicPropConfig } from '@animus-ui/extract/pipeline';
import { createSystem, createTheme, size } from '@animus-ui/system';
import { expect, test } from 'vitest';

import { resolveClasses } from '../../system/src/runtime/resolveClasses';
import { analyzeProject, transformFile } from './run-pipeline';

/**
 * Props alike in the properties they write, the current variable and the
 * transform share one slot variable and rule. Of props that one element sets
 * on one CSS property, the later-defined takes effect, literal or runtime,
 * whatever their order on the element.
 */
const theme = createTheme().addBreakpoints({ sm: 640 }).build().serialize();
const config = createSystem()
  .addGroup('probe', {
    height: { property: 'height', transform: size },
    h: { property: 'height', transform: size },
    rawH: { property: 'height' },
  })
  .build()
  .seal()
  .toConfig();

const path = 'fixtures/shared-slots.tsx';
const source = `import { ds } from './setup';
export const Box = ds.system({ probe: true }).asElement('div');
export const App = ({ n }) => (
  <>
    <Box h={n} height={n} rawH={n} />
    <Box h="10px" height="20px" />
    <Box h="50px" height="60px" />
  </>
);`;
const manifest = JSON.parse(
  analyzeProject(JSON.stringify([{ path, source }]), {
    ...theme,
    propConfigJson: config.propConfig,
    groupRegistryJson: config.groupRegistry,
  })
);
const css: string = manifest.css;
const dynamicProps = buildDynamicPropConfig(manifest.dynamic_props);
const supersededBy = JSON.parse(
  transformFile(path, source).code.match(/"supersededBy":(\{[^}]*\})/)?.[1] ??
    'null'
);
const resolve = (props: Record<string, string>) =>
  resolveClasses(
    'animus-Box',
    props,
    {
      systemPropNames: ['height', 'h', 'rawH'],
      typedSystemProps: manifest.typed_system_props,
      supersededBy,
    },
    manifest.system_prop_map,
    dynamicProps
  );

test('props on one property with one transform share a slot; the later-defined prop wins', () => {
  const slot = dynamicProps.h;
  expect(dynamicProps.height).toEqual(
    expect.objectContaining({
      varName: slot.varName,
      slotClass: slot.slotClass,
    })
  );
  expect(dynamicProps.rawH.slotClass).not.toBe(slot.slotClass);
  expect(css.match(/\.animus-dyn-[\w-]+\s*\{/g)).toHaveLength(4);
  expect(
    manifest.sheets.global.match(/@property --animus-h_-sm /g)
  ).toHaveLength(1);

  expect(resolve({ height: '12px', h: '24px' })).toEqual({
    classes: ['animus-Box', slot.slotClass],
    dynamicStyle: { [slot.varName]: '24px' },
    activeStates: [],
  });
  expect(resolve({ h: '24px', height: '12px' }).dynamicStyle).toEqual({
    [slot.varName]: '24px',
  });
});

test('of literal and runtime props on one property, the later-defined takes effect', () => {
  expect(supersededBy).toEqual({ height: ['h', 'rawH'], h: ['rawH'] });
  const [, h10] = resolve({ h: '10px' }).classes;
  const [, h50] = resolve({ h: '50px' }).classes;
  const [, height20] = resolve({ height: '20px' }).classes;
  const [, height60] = resolve({ height: '60px' }).classes;
  // The pairs' rules sort in opposite orders, so no stylesheet order picks h
  // for both.
  const before = (a: string, b: string) =>
    css.indexOf(`.${a}`) < css.indexOf(`.${b}`);
  expect(before(h10, height20)).not.toBe(before(h50, height60));

  for (const [h, height, kept] of [
    ['10px', '20px', h10],
    ['50px', '60px', h50],
  ]) {
    expect(resolve({ h, height }).classes).toEqual(['animus-Box', kept]);
    expect(resolve({ height, h }).classes).toEqual(['animus-Box', kept]);
  }
  expect(resolve({ height: '20px', h: '77px' })).toEqual({
    classes: ['animus-Box', dynamicProps.h.slotClass],
    dynamicStyle: { [dynamicProps.h.varName]: '77px' },
    activeStates: [],
  });
  expect(resolve({ h: '10px', height: '88px' })).toEqual({
    classes: ['animus-Box', h10],
    dynamicStyle: undefined,
    activeStates: [],
  });
});
