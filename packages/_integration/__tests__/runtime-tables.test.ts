import { buildSystemPropsModule } from '@animus-ui/extract/pipeline';
import { createSystem, createTheme } from '@animus-ui/system';
import { expect, test } from 'vitest';

import { analyzeProject } from './run-pipeline';

import type { ProjectManifest } from '@animus-ui/extract/pipeline';

// Contract: a runtime config references its scale values and keywords from
// the system-props module's one `animusTables` export, keyed by the scale's
// and the property's name, and never inlines them.
test('runtime configs reference shared tables by name, never inline', async () => {
  const theme = createTheme()
    .addColors({ ink: '#111111', paper: '#fefefe' })
    .build()
    .serialize();
  const config = createSystem()
    .addGroup('color', { bg: { property: 'backgroundColor', scale: 'colors' } })
    .build()
    .seal()
    .toConfig();
  const manifest: ProjectManifest = JSON.parse(
    analyzeProject(
      JSON.stringify([
        {
          path: 'fixtures/runtime-tables.tsx',
          source: `import { ds } from './setup';
export const A = ds.props({ tone: { property: 'color', scale: 'colors' } }).system({ color: true }).asElement('div');
export const B = ds.props({ edge: { property: 'color', scale: 'colors' } }).asElement('div');
export const App = ({ v }) => <><A tone={v} bg={v} /><B edge={v} /></>;`,
        },
      ]),
      {
        ...theme,
        propConfigJson: config.propConfig,
        groupRegistryJson: config.groupRegistry,
      }
    )
  );

  for (const id of ['A', 'B']) {
    const { replacement } =
      manifest.components[`fixtures/runtime-tables.tsx::${id}`];
    expect(replacement).toContain('animusTables.scaleValues["colors"]');
    expect(replacement).toContain('animusTables.keywords["color"]');
    expect(replacement).not.toContain('var(--color-paper)');
    expect(replacement).not.toContain('currentColor');
  }

  const source = buildSystemPropsModule({
    systemPropMapJson: '{}',
    groupRegistryJson: '{}',
    dynamicProps: manifest.dynamic_props,
    admittedTransforms: manifest.admitted_transforms,
    typedSystemProps: manifest.typed_system_props,
    runtimeTables: manifest.runtime_tables,
  });
  expect(source.split('var(--color-paper)')).toHaveLength(2);
  const { animusTables, dynamicPropConfig } = await import(
    `data:text/javascript,${encodeURIComponent(source)}`
  );
  expect(dynamicPropConfig.bg.scaleValues).toBe(
    animusTables.scaleValues.colors
  );
  expect(animusTables.scaleValues.colors).toMatchObject({
    paper: 'var(--color-paper)',
  });
});
