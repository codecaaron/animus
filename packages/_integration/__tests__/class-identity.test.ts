import { expect, test } from 'vitest';

import { config } from '../fixtures/setup';
import { analyzeProject } from './run-pipeline';

/**
 * A production class name comes from the system and the definition, not
 * from where the definition is installed: two copies of one definition share
 * their class, which keeps every option and runtime slot either copy's
 * usage keeps and is written once, and a changed definition gets its own. In development a
 * project's own files keep names from where they are defined, so an edit
 * keeps its class, while an installed kit's names stay semantic.
 */
const button = (
  radius: string,
  size: string,
  runtime: string
) => `import { ds } from '../../../fixtures/setup';
export const Button = ds
  .styles({ cursor: 'pointer', borderRadius: '${radius}' })
  .variant({ prop: 'size', variants: { sm: { cursor: 'help' }, lg: { cursor: 'wait' } } })
  .props({ lift: { property: 'boxShadow' }, tilt: { property: 'rotate' } })
  .asElement('button');
export const Use = ({ v }: { v: string }) => <Button size="${size}" ${runtime}={v} />;`;
const app = `import { ds } from './setup';
export const Card = ds.styles({ cursor: 'default' }).asElement('div');
export const App = () => <Card />;`;

const KIT = 'node_modules/kit/src/Button.tsx';
const NESTED = 'node_modules/other/node_modules/kit/src/Button.tsx';
const APP = 'fixtures/App.tsx';

const analyze = (nestedRadius: string, devMode = false) => {
  const manifest = JSON.parse(
    analyzeProject(
      JSON.stringify([
        { path: KIT, source: button('4px', 'sm', 'lift') },
        { path: NESTED, source: button(nestedRadius, 'lg', 'tilt') },
        { path: APP, source: app },
      ]),
      { devMode, selectorAliasesJson: config.selectorAliases }
    )
  );
  const classOf = (path: string, binding: string): string =>
    manifest.components[`${path}::${binding}`].class_name;
  const count = (sheet: string, selector: string) =>
    manifest.sheets[sheet].split(`.${selector} {`).length - 1;
  return { classOf, count };
};

test('copies of one definition share one class, written once with every kept option and runtime slot', () => {
  const { classOf, count } = analyze('4px');
  const shared = classOf(KIT, 'Button');
  expect(classOf(NESTED, 'Button')).toBe(shared);
  expect(shared).toMatch(/^animus-Button-[0-9a-f]{8}$/);
  expect(count('base', shared)).toBe(1);
  expect(count('variants', `${shared}--size-sm`)).toBe(1);
  expect(count('variants', `${shared}--size-lg`)).toBe(1);
  const hash = shared.slice(shared.lastIndexOf('-') + 1);
  expect(count('custom', `animus-dyn-lift_${hash}`)).toBe(1);
  expect(count('custom', `animus-dyn-tilt_${hash}`)).toBe(1);
});

test('a copy whose usage the analysis cannot see keeps every option and state for every copy', () => {
  const definition = `ds
  .styles({ cursor: 'pointer' })
  .variant({ prop: 'size', variants: { sm: { cursor: 'help' }, lg: { cursor: 'wait' } } })
  .states({ busy: { opacity: 0.5 }, idle: { opacity: 1 } })`;
  const manifest = JSON.parse(
    analyzeProject(
      JSON.stringify([
        {
          path: KIT,
          source: `import { ds } from '../../../fixtures/setup';
export const Button = ${definition}.asClass();`,
        },
        {
          path: NESTED,
          source: `import { ds } from '../../../fixtures/setup';
export const Button = ${definition}.asElement('button');
export const Use = () => <Button size="sm" busy />;`,
        },
      ]),
      { selectorAliasesJson: config.selectorAliases }
    )
  );
  const shared = manifest.components[`${KIT}::Button`].class_name;
  expect(manifest.components[`${NESTED}::Button`].class_name).toBe(shared);
  expect(manifest.sheets.variants).toContain(`.${shared}--size-lg {`);
  expect(manifest.sheets.states).toContain(`.${shared}--idle {`);
});

test('a changed definition gets its own class', () => {
  const equal = analyze('4px');
  const changed = analyze('8px');
  expect(changed.classOf(KIT, 'Button')).toBe(equal.classOf(KIT, 'Button'));
  expect(changed.classOf(NESTED, 'Button')).not.toBe(
    changed.classOf(KIT, 'Button')
  );
});

test('development names project files by location and installed kits by definition', () => {
  const production = analyze('4px');
  const development = analyze('4px', true);
  expect(development.classOf(KIT, 'Button')).toBe(
    production.classOf(KIT, 'Button')
  );
  expect(development.classOf(APP, 'Card')).not.toBe(
    production.classOf(APP, 'Card')
  );
  expect(analyze('8px', true).classOf(APP, 'Card')).toBe(
    development.classOf(APP, 'Card')
  );
});
