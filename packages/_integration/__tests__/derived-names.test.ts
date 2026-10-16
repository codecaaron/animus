import { expect, test } from 'vitest';

import { resolveConfig } from '../../system/src/runtime/resolveClasses';
import { inlineTables, runPipeline } from './run-pipeline';

import type { ClassResolverConfig } from '../../system/src/runtime/resolveClasses';

// Contract: a slot class and variable the runtime builds from a config's
// scope, and a compound class it builds from the compound's position, equal
// the names the stylesheet declares, for every prop, `__proto__` included.
test('names derived from a scope and a position equal the emitted names', () => {
  const path = 'fixtures/derived-names.tsx';
  const source = `import { ds } from './setup';
export const Parent = ds
  .variant({ prop: 'size', variants: { sm: {}, lg: {} } })
  .compound({ size: 'sm' }, { display: 'flex' })
  .compound({ size: 'lg' }, { display: 'grid' })
  .props({
    tone: { property: 'color' },
    'x-tone': { property: 'borderColor' },
    lift: { property: 'height' },
    raise: { property: 'height' },
    ['__proto__']: { property: 'outlineColor' },
  })
  .asElement('div');
export const Child = Parent.extend().compound({ size: 'sm' }, { display: 'inline' }).asElement('section');
export const App = ({ v }) => (
  <>
    <Parent size="sm" tone={v} x-tone={v} lift={v} raise={v} __proto__={v} />
    <Child size="lg" tone={v} />
  </>
);`;
  const { manifest, css } = runPipeline([{ path, source }]);

  const configOf = (id: string): [string, ClassResolverConfig] => {
    const { replacement, class_name } = manifest.components[`${path}::${id}`];
    const call = inlineTables(manifest, replacement);
    const args = new Function(
      'createComponent',
      'systemPropMap',
      'dynamicPropConfig',
      `return ${call};`
    )((...a: unknown[]) => a, {}, {});
    return [class_name, args[2]];
  };

  for (const id of ['Parent', 'Child']) {
    const [className, emitted] = configOf(id);
    const resolved = resolveConfig(className, emitted);
    expect(emitted.compounds?.every((c) => c.className === undefined)).toBe(
      true
    );
    for (const { className: compound } of resolved.compounds ?? []) {
      expect(css).toContain(`.${compound} {`);
    }
    for (const dc of Object.values(resolved.customDynamicConfig ?? {})) {
      expect(css).toContain(`.${dc.slotClass} {`);
      if (dc.kind !== 'declarations')
        expect(css).toContain(`var(${dc.varName})`);
    }
  }

  const [, parent] = configOf('Parent');
  const dynamic = parent.customDynamicConfig ?? {};
  // A name that is not ASCII letters and digits derives through its hex.
  expect(dynamic['x-tone']).not.toHaveProperty('slotClass');
  // A prop named `__proto__` is an own entry before and after resolution.
  expect(Object.hasOwn(dynamic, '__proto__')).toBe(true);
  const [parentClass] = configOf('Parent');
  expect(
    Object.hasOwn(
      resolveConfig(parentClass, parent).customDynamicConfig ?? {},
      '__proto__'
    )
  ).toBe(true);
  // `raise` shares `lift`'s slot, so its names ship.
  expect(dynamic.lift).not.toHaveProperty('slotClass');
  expect(dynamic.raise).toHaveProperty('slotClass');
});
