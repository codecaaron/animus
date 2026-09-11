import { describe, expect, it } from 'vitest';

import {
  areTransformsEqual,
  createSystem,
  createTransform,
  type Prop,
  type TransformFn,
} from '../src';

function prop(overrides: Partial<Prop> = {}): Prop {
  return { property: 'margin', ...overrides };
}

describe('anonymous transform identity across extend()', () => {
  it('divergent anonymous transforms from two kits fail loud, never coalesce', () => {
    const kitA = createSystem()
      .addGroup('a', {
        gap: prop({ property: 'gap', transform: (v) => `${v}px` }),
      })
      .build()
      .seal();
    const kitB = createSystem()
      .addGroup('b', {
        gap: prop({ property: 'gap', transform: (v) => `${v}rem` }),
      })
      .build()
      .seal();

    expect(() => createSystem().extend(kitA).extend(kitB)).toThrow(/gap/);
  });

  it('repeated extension of one kit instance still coalesces', () => {
    const kit = createSystem()
      .addGroup('a', {
        gap: prop({ property: 'gap', transform: (v) => `${v}px` }),
      })
      .build()
      .seal();

    expect(() => createSystem().extend(kit).extend(kit)).not.toThrow();
  });

  it('re-registering the kit prop with the same transform instance coalesces', () => {
    const shared: TransformFn = (v) => `${v}px`;
    const kit = createSystem()
      .addGroup('a', { gap: prop({ property: 'gap', transform: shared }) })
      .build()
      .seal();

    expect(() =>
      createSystem()
        .extend(kit)
        .addProps({ gap: prop({ property: 'gap', transform: shared }) })
    ).not.toThrow();
  });
});

describe('serialization duplicate-name guard', () => {
  it('two different anonymous transforms sharing an inferred name fail loud', () => {
    const { system } = createSystem()
      .addGroup('layout', {
        gap: prop({ property: 'gap', transform: (v) => `${v}px` }),
        pad: prop({ property: 'padding', transform: (v) => `${v}rem` }),
      })
      .build();

    expect(() => system.toConfig()).toThrow(/Transform name "transform"/);
  });

  it('one shared anonymous transform across two props serializes fine', () => {
    const shared: TransformFn = (v) => `${v}px`;
    const { system } = createSystem()
      .addGroup('layout', {
        gap: prop({ property: 'gap', transform: shared }),
        pad: prop({ property: 'padding', transform: shared }),
      })
      .build();

    expect(() => system.toConfig()).not.toThrow();
  });
});

describe('createTransform over a createTransform product', () => {
  it('inherits the innermost captured source, not the wrapper text', () => {
    const px = createTransform('px', (v) => `${v}px`);
    const rem = createTransform('rem', (v) => `${v}rem`);

    expect(
      areTransformsEqual(
        createTransform('size', px),
        createTransform('size', rem)
      )
    ).toBe(false);
    expect(
      areTransformsEqual(
        createTransform('size', px),
        createTransform('size', px)
      )
    ).toBe(true);
  });
});

describe('structural scale comparison in addGroup/addProps', () => {
  const gridKit = () =>
    createSystem()
      .addGroup('grid', {
        flow: prop({ property: 'gridAutoFlow', scale: [] }),
      })
      .build()
      .seal();

  it('re-registering an identical object-scaled prop after extend() coalesces', () => {
    expect(() =>
      createSystem()
        .extend(gridKit())
        .addGroup('g2', {
          flow: prop({ property: 'gridAutoFlow', scale: [] }),
        })
    ).not.toThrow();

    expect(() =>
      createSystem()
        .extend(gridKit())
        .addProps({ flow: prop({ property: 'gridAutoFlow', scale: [] }) })
    ).not.toThrow();
  });

  it('a genuinely divergent scale still fails loud', () => {
    expect(() =>
      createSystem()
        .extend(gridKit())
        .addProps({
          flow: prop({ property: 'gridAutoFlow', scale: ['dense'] }),
        })
    ).toThrow(/flow/);
  });
});
