import {
  applyUnitFallback,
  buildDynamicPropConfig,
} from '@animus-ui/extract/pipeline';
import { createSystem, createTheme } from '@animus-ui/system';
import { expect, test } from 'vitest';

import { resolveClasses } from '../../system/src/runtime/resolveClasses';
import { analyzeProject } from './run-pipeline';

/**
 * A prop with `currentVar` writes it from its runtime slot as a static write
 * does, so a descendant reading the variable sees the runtime value. A value
 * that reads the variable itself takes the slot that leaves it alone.
 */
const currentVarSystem = () => {
  const theme = createTheme()
    .addBreakpoints({ sm: 640 })
    .addColors({ ink: '#111' })
    .declareContextualVars({ colors: ['current-bg'] })
    .build()
    .serialize();
  const config = createSystem()
    .addGroup('probe', {
      bg: {
        property: 'backgroundColor',
        scale: 'colors',
        currentVar: '--current-bg',
      },
      p: { property: 'padding' },
    })
    .build()
    .seal()
    .toConfig();
  return {
    ...theme,
    propConfigJson: config.propConfig,
    groupRegistryJson: config.groupRegistry,
  };
};

const source = `import { ds } from './setup';
export const Box = ds.system({ probe: true }).asElement('div');
export const App = ({ n }) => <Box bg={n} p={n} />;`;
const manifest = JSON.parse(
  analyzeProject(
    JSON.stringify([{ path: 'fixtures/current-var.tsx', source }]),
    currentVarSystem()
  )
);
const css = applyUnitFallback(manifest.css).replace(/\s+/g, ' ');
const resolve = (bg: string | Record<string, string>) =>
  resolveClasses(
    'animus-Box',
    { bg },
    { systemPropNames: ['bg'] },
    manifest.system_prop_map,
    buildDynamicPropConfig(manifest.dynamic_props)
  );

test('the slot writes currentVar, and a second slot leaves it alone', () => {
  expect(css).toContain(
    '.animus-dyn-bg { background-color: var(--animus-bg); --current-bg: var(--animus-bg); }'
  );
  expect(css).toContain(
    '.animus-dyn-bg--keep { background-color: var(--animus-bg); }'
  );
  expect(css).toMatch(
    /@media \(min-width: 640px\) \{ \.animus-dyn-bg-sm \{ background-color: var\(--animus-bg-sm\); --current-bg: var\(--animus-bg-sm\); \}/
  );
  expect(css).toMatch(
    /@media \(min-width: 640px\) \{ \.animus-dyn-bg--keep-sm \{ background-color: var\(--animus-bg-sm\); \}/
  );
});

test('a prop without currentVar keeps one slot', () => {
  expect(css).toContain('.animus-dyn-p { padding: var(--animus-p); }');
  expect(css).not.toContain('animus-dyn-p--keep');
});

test('a runtime value selects the slot that writes currentVar', () => {
  expect(resolve('ink')).toEqual({
    classes: ['animus-Box', 'animus-dyn-bg'],
    dynamicStyle: { '--animus-bg': 'var(--color-ink)' },
    activeStates: [],
  });
});

test('a runtime value reading currentVar selects the slot that leaves it alone', () => {
  expect(resolve({ _: 'current-bg', sm: 'ink' })).toEqual({
    classes: ['animus-Box', 'animus-dyn-bg--keep', 'animus-dyn-bg-sm'],
    dynamicStyle: {
      '--animus-bg': 'var(--current-bg)',
      '--animus-bg-sm': 'var(--color-ink)',
    },
    activeStates: [],
  });
});
