import { createSystem, createTheme } from '@animus-ui/system';
import { expect, test } from 'vitest';

import { analyzeProject } from './run-pipeline';

/**
 * Every variable a value slot's rule reads is registered non-inheriting, and
 * nothing else is: a slot reads its variable on the element carrying both its
 * class and the inline value, while a currentVar and a declaration prop's
 * member variables are read by descendants and keep inheriting.
 */
const theme = createTheme()
  .addBreakpoints({ sm: 640 })
  .addColors({ ink: '#111' })
  .addDeclarationScale({
    name: 'looks',
    values: {
      loud: { backgroundColor: 'red' },
      calm: { backgroundColor: 'green' },
    },
  })
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
    look: {
      kind: 'declarations',
      scale: 'looks',
      members: ['backgroundColor'],
    },
  })
  .build()
  .seal()
  .toConfig();

const source = `import { ds } from './setup';
export const Box = ds
  .props({ lift: { property: 'boxShadow' } })
  .system({ probe: true })
  .asElement('div');
export const App = ({ n }) => <Box bg={n} p={n} look={n} lift={n} />;`;
const manifest = JSON.parse(
  analyzeProject(
    JSON.stringify([{ path: 'fixtures/slot-registration.tsx', source }]),
    {
      ...theme,
      propConfigJson: config.propConfig,
      groupRegistryJson: config.groupRegistry,
    }
  )
);
const global: string = manifest.sheets.global;
const css: string = manifest.css.replace(/\s+/g, ' ');

const registered = [
  ...global.matchAll(
    /@property (--[\w-]+) \{ syntax: "\*"; inherits: false; \}/g
  ),
].map(([, name]) => name);
const readsOf = (selector: RegExp) =>
  new Set(
    [...css.matchAll(selector)].flatMap(([, body]) =>
      [...body.matchAll(/var\((--[\w-]+)/g)].map(([, name]) => name)
    )
  );
const slotReads = readsOf(/\.animus-dyn-[\w-]+ \{([^}]*)\}/g);
const declarationReads = readsOf(/\.animus-dcl-[\w-]+ \{([^}]*)\}/g);

test('the variables value slots read are registered, ahead of the global sheet', () => {
  expect(registered).toEqual([...slotReads].sort());
  expect(registered).toEqual(
    expect.arrayContaining([
      '--animus-p_',
      '--animus-p_-sm',
      '--animus-bg_',
      '--animus-bg_-sm',
    ])
  );
  expect(registered.some((name) => name.startsWith('--animus-lift_'))).toBe(
    true
  );
  expect(global.startsWith('@property ')).toBe(true);
});

test('a currentVar and declaration member variables stay unregistered', () => {
  expect(declarationReads.size).toBeGreaterThan(0);
  for (const name of [...declarationReads, '--current-bg']) {
    expect(global).not.toContain(`@property ${name} `);
  }
});
