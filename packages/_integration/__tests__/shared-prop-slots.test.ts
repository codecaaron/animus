import { buildDynamicPropConfig } from '@animus-ui/extract/pipeline';
import { createSystem, createTheme, size } from '@animus-ui/system';
import { expect, test } from 'vitest';

import { resolveClasses } from '../../system/src/runtime/resolveClasses';
import { analyzeProject } from './run-pipeline';

/**
 * Props alike in the properties they write, the current variable and the
 * transform share one slot variable and rule; of two that one element sets,
 * the later-defined prop wins, whatever their order on the element.
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

const source = `import { ds } from './setup';
export const Box = ds.system({ probe: true }).asElement('div');
export const App = ({ n }) => <Box h={n} height={n} rawH={n} />;`;
const manifest = JSON.parse(
  analyzeProject(
    JSON.stringify([{ path: 'fixtures/shared-slots.tsx', source }]),
    {
      ...theme,
      propConfigJson: config.propConfig,
      groupRegistryJson: config.groupRegistry,
    }
  )
);
const css: string = manifest.css;
const dynamicProps = buildDynamicPropConfig(manifest.dynamic_props);
const resolve = (props: Record<string, string>) =>
  resolveClasses(
    'animus-Box',
    props,
    { systemPropNames: ['height', 'h', 'rawH'] },
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

  expect(resolve({ height: '10px', h: '20px' })).toEqual({
    classes: ['animus-Box', slot.slotClass],
    dynamicStyle: { [slot.varName]: '20px' },
    activeStates: [],
  });
  expect(resolve({ h: '20px', height: '10px' }).dynamicStyle).toEqual({
    [slot.varName]: '20px',
  });
});
