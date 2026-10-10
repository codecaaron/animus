import { buildDynamicPropConfig } from '@animus-ui/extract/pipeline';
import { createSystem, createTheme } from '@animus-ui/system';
import { afterEach, expect, test, vi } from 'vitest';

import { resolveClasses } from '../../system/src/runtime/resolveClasses';
import { analyzeProject } from './run-pipeline';

/**
 * Code outside the analysis can clone a runtime value into an element the
 * build saw written with a literal. Where the build misses that route, a
 * production build removes the prop's slot and the value silently has no
 * style there. The development runtime names it instead: development keeps
 * the slot and records the conditions production keeps, and warns when a
 * value reaches one production removes.
 */
const theme = createTheme().addBreakpoints({ sm: 640 }).build().serialize();
const config = createSystem()
  .addGroup('space', { p: { property: 'padding' } })
  .build()
  .seal()
  .toConfig();

// A function prop the analysis takes for analysed code hands the element to
// `enhance`, which clones a runtime `p` into it.
const path = 'fixtures/pruned-slot.tsx';
const source = `import { ds } from './setup';
import { enhance } from 'ui-lib';
export const Box = ds.system({ space: true }).asElement('div');
function Wrap({ apply }) { return <div>{apply(<Box p={8} />)}</div>; }
export const App = () => <Wrap apply={enhance} />;`;
const analyze = (devMode: boolean) =>
  JSON.parse(
    analyzeProject(JSON.stringify([{ path, source }]), {
      ...theme,
      propConfigJson: config.propConfig,
      groupRegistryJson: config.groupRegistry,
      devMode,
    })
  );

afterEach(() => {
  vi.restoreAllMocks();
});

test('a runtime value reaching a slot production removes warns in development', () => {
  // Production removes the slot: the cloned value would have no style.
  expect(analyze(false).dynamic_props).not.toHaveProperty('p');

  const manifest = analyze(true);
  const dynamicProps = buildDynamicPropConfig(manifest.dynamic_props);
  expect(dynamicProps.p.productionConditions).toEqual([]);

  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const resolved = resolveClasses(
    'animus-Box',
    { p: '12px' },
    { systemPropNames: ['p'] },
    manifest.system_prop_map,
    dynamicProps
  );
  // Development still renders the value through its slot, and says so.
  expect(resolved.dynamicStyle).toEqual({ [dynamicProps.p.varName]: '12px' });
  expect(warn).toHaveBeenCalledWith(
    expect.stringMatching(
      /^\[animus:drop\] animus-Box: value 12px on prop 'p' uses its runtime slot at _, which a production build removes/
    )
  );
});

test('an entry a static class serves does not warn', () => {
  // A runtime `p` keeps the base slot; a literal `!important` entry takes a
  // static class at `sm`, as the runtime applies it in either mode.
  const hybrid = `import { ds } from './setup';
export const Box = ds.system({ space: true }).asElement('div');
export const App = ({ n }) => <><Box p={n + 1} /><Box p={{ sm: '8px!' }} /></>;`;
  const manifest = JSON.parse(
    analyzeProject(JSON.stringify([{ path, source: hybrid }]), {
      ...theme,
      propConfigJson: config.propConfig,
      groupRegistryJson: config.groupRegistry,
      devMode: true,
    })
  );
  const dynamicProps = buildDynamicPropConfig(manifest.dynamic_props);
  expect(dynamicProps.p.productionConditions).toEqual(['_']);

  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const resolved = resolveClasses(
    'animus-Hybrid',
    { p: { _: 12, sm: '8px!' } },
    { systemPropNames: ['p'] },
    manifest.system_prop_map,
    dynamicProps
  );
  expect(resolved.classes).toContain(manifest.system_prop_map.p['sm:8px!']);
  expect(warn).not.toHaveBeenCalled();
});
