import { createElement } from 'react';

import { buildSystemPropsModule } from '@animus-ui/extract/pipeline';
import {
  createComponent,
  createSystem,
  createTheme,
  size,
} from '@animus-ui/system';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';

import { analyzeProject, transformFile } from './run-pipeline';

// Contract: a config references the system's one `supersededBy` table, and
// the runtime narrows it to the system props the component lists and does
// not own, so a prop the component does not apply never supersedes one it
// does.
test('a component narrows the system supersession table to its own system props', async () => {
  const theme = createTheme().build().serialize();
  const config = createSystem()
    .addGroup('probe', {
      height: { property: 'height', transform: size },
      h: { property: 'height', transform: size },
      rawH: { property: 'height' },
    })
    .build()
    .seal()
    .toConfig();
  const path = 'fixtures/superseded-narrowing.tsx';
  const source = `import { ds } from './setup';
export const Listed = ds.system({ height: true, h: true }).asElement('div');
export const Owned = ds.system({ probe: true }).props({ rawH: { property: 'width' } }).asElement('div');
export const App = ({ n }) => (
  <>
    <Listed height="12px" h="24px" rawH={n} />
    <Owned h="24px" rawH={n} />
  </>
);`;
  const manifest = JSON.parse(
    analyzeProject(JSON.stringify([{ path, source }]), {
      ...theme,
      propConfigJson: config.propConfig,
      groupRegistryJson: config.groupRegistry,
    })
  );
  expect(manifest.superseded_by).toEqual({
    height: ['h', 'rawH'],
    h: ['rawH'],
  });
  const code = transformFile(path, source).code;
  expect(code.match(/"supersededBy":supersededBy/g)).toHaveLength(2);

  const shared = await import(
    `data:text/javascript,${encodeURIComponent(
      buildSystemPropsModule({
        systemPropMapJson: JSON.stringify(manifest.system_prop_map),
        groupRegistryJson: config.groupRegistry,
        dynamicProps: manifest.dynamic_props,
        admittedTransforms: manifest.admitted_transforms,
        typedSystemProps: manifest.typed_system_props,
        runtimeTables: manifest.runtime_tables,
        propNameLists: manifest.prop_name_lists,
        supersededBy: manifest.superseded_by,
      })
    )}`
  );
  const render = (id: string, props: Record<string, string>) => {
    const { replacement } = manifest.components[`${path}::${id}`];
    const scope = { ...shared, createComponent };
    const Component = new Function(
      ...Object.keys(scope),
      `return ${replacement};`
    )(...Object.values(scope));
    return renderToStaticMarkup(createElement(Component, props));
  };
  // A transform-bound prop keys its classes by the typed value.
  const hClass = manifest.system_prop_map.h['"24px"'];
  const heightClass = manifest.system_prop_map.height['"12px"'];
  expect(hClass).toBeDefined();

  // `Listed` does not apply `rawH`, so it supersedes nothing there.
  expect(render('Listed', { h: '24px', rawH: '5px' })).toContain(hClass);
  // `h` still supersedes `height` where the component lists both.
  const both = render('Listed', { height: '12px', h: '24px' });
  expect(both).toContain(hClass);
  expect(both).not.toContain(heightClass);
  // `Owned` owns `rawH`, so its own prop supersedes no system prop.
  expect(render('Owned', { h: '24px', rawH: '5px' })).toContain(hClass);
});
