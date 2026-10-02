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

describe('configured transform bindings', () => {
  type Entry = { transform?: string; transformId?: string };
  const serialize = (props: Record<string, Prop>) => {
    const config = createSystem().addProps(props).build().system.toConfig();
    const entries: Record<string, Entry> = JSON.parse(config.propConfig);
    const sources: Record<string, string> = JSON.parse(config.transformSources);
    return { config, props: entries, sources };
  };

  it('one callable bound to two props is one definition', () => {
    const double = createTransform('double', (v) => Number(v) * 2);
    const { props, sources } = serialize({
      wide: prop({ property: 'width', transform: double }),
      tall: prop({ property: 'height', transform: double }),
    });

    expect(props.wide.transform).toBe('double');
    expect(props.tall.transform).toBe('double');
    expect(props.wide.transformId).toEqual(expect.any(String));
    expect(props.tall.transformId).toBe(props.wide.transformId);
    expect(Object.keys(sources)).toEqual([props.wide.transformId]);
  });

  it.each([
    [
      'createTransform',
      createTransform('unit', (v) => `${v}px`),
      createTransform('unit', (v) => `${v}rem`),
    ],
    [
      'plain functions',
      function unit(v: string | number) {
        return `${v}px`;
      },
      function unit(v: string | number) {
        return `${v}rem`;
      },
    ],
  ] as const)(
    'distinct %s sharing a readable name stay separate bindings',
    (_form, px, rem) => {
      const { config, props } = serialize({
        wide: prop({ property: 'width', transform: px }),
        tall: prop({ property: 'height', transform: rem }),
      });

      expect(props.wide.transform).toBe('unit');
      expect(props.tall.transform).toBe('unit');
      expect(props.wide.transformId).not.toBe(props.tall.transformId);
      expect(config.transforms[props.wide.transformId!](4)).toBe('4px');
      expect(config.transforms[props.tall.transformId!](4)).toBe('4rem');
    }
  );

  it('two different anonymous transforms sharing an inferred name stay separate', () => {
    const { props } = serialize({
      gap: prop({ property: 'gap', transform: (v) => `${v}px` }),
      pad: prop({ property: 'padding', transform: (v) => `${v}rem` }),
    });

    expect(props.gap.transform).toBe('transform');
    expect(props.pad.transform).toBe('transform');
    expect(props.gap.transformId).not.toBe(props.pad.transformId);
  });

  it('identical callback text in two instances is two definitions', () => {
    const { props, sources } = serialize({
      wide: prop({
        property: 'width',
        transform: createTransform('same', (v) => `${v}px`),
      }),
      tall: prop({
        property: 'height',
        transform: createTransform('same', (v) => `${v}px`),
      }),
    });

    expect(props.wide.transformId).not.toBe(props.tall.transformId);
    expect(Object.keys(sources)).toHaveLength(2);
  });

  it('identity ignores registration order and unrelated props', () => {
    const px = createTransform('unit', (v) => `${v}px`);
    const rem = createTransform('unit', (v) => `${v}rem`);
    const first = serialize({
      wide: prop({ property: 'width', transform: px }),
      tall: prop({ property: 'height', transform: rem }),
    }).props;
    const second = serialize({
      aside: prop({
        property: 'top',
        transform: createTransform('aside', (v) => `${v}vh`),
      }),
      tall: prop({ property: 'height', transform: rem }),
      wide: prop({ property: 'width', transform: px }),
    }).props;

    expect(second.wide.transformId).toBe(first.wide.transformId);
    expect(second.tall.transformId).toBe(first.tall.transformId);
  });

  it('a callback edit keeps its binding identity and changes its delivered source', () => {
    const before = serialize({
      wide: prop({
        property: 'width',
        transform: createTransform('unit', (v) => `${v}px`),
      }),
    });
    const after = serialize({
      wide: prop({
        property: 'width',
        transform: createTransform('unit', (v) => `${v}em`),
      }),
    });
    const id = before.props.wide.transformId!;

    expect(after.props.wide.transformId).toBe(id);
    expect(before.sources[id]).toContain('px');
    expect(after.sources[id]).toContain('em');
  });

  it('one shared anonymous transform across two props is one definition', () => {
    const shared: TransformFn = (v) => `${v}px`;
    const { props } = serialize({
      gap: prop({ property: 'gap', transform: shared }),
      pad: prop({ property: 'padding', transform: shared }),
    });

    expect(props.gap.transformId).toEqual(expect.any(String));
    expect(props.gap.transformId).toBe(props.pad.transformId);
  });
});

describe('configured binding identity across extend()', () => {
  type Entry = { transform?: string; transformId?: string };
  const bindings = (config: {
    propConfig: string;
    transformSources: string;
  }) => {
    const props: Record<string, Entry> = JSON.parse(config.propConfig);
    const sources: Record<string, string> = JSON.parse(config.transformSources);
    return { props, sources };
  };
  const size = createTransform('size', (v) => `${Number(v) * 3}px`);
  const parentKit = () =>
    createSystem()
      .addProps({ width: prop({ property: 'width', transform: size }) })
      .build()
      .seal();

  it('a child rebinding the parent callable shares its definition', () => {
    const { system } = createSystem()
      .extend(parentKit())
      .addProps({ height: prop({ property: 'height', transform: size }) })
      .build();
    const config = system.toConfig();
    const { props, sources } = bindings(config);

    expect(props.height.transformId).toBe(props.width.transformId);
    expect(Object.keys(sources)).toEqual([props.width.transformId]);
    expect(config.transforms[props.width.transformId!](4)).toBe('12px');
  });

  it('a grandchild rebinding the grandparent callable shares its definition', () => {
    const child = createSystem()
      .extend(parentKit())
      .addProps({ gap: prop({ property: 'gap' }) })
      .build()
      .seal();
    const { system } = createSystem()
      .extend(child)
      .addProps({ height: prop({ property: 'height', transform: size }) })
      .build();
    const { props, sources } = bindings(system.toConfig());

    expect(props.height.transformId).toBe(props.width.transformId);
    expect(Object.keys(sources)).toHaveLength(1);
  });

  it('inheritance alone keeps one definition', () => {
    const { system } = createSystem().extend(parentKit()).build();
    const { props, sources } = bindings(system.toConfig());

    expect(props.width.transformId).toEqual(expect.any(String));
    expect(Object.keys(sources)).toEqual([props.width.transformId]);
  });

  it('a child binding a distinct same-named callable stays separate', () => {
    const { system } = createSystem()
      .extend(parentKit())
      .addProps({
        height: prop({
          property: 'height',
          transform: createTransform('size', (v) => `${Number(v) * 3}px`),
        }),
      })
      .build();
    const { props, sources } = bindings(system.toConfig());

    expect(props.height.transformId).not.toBe(props.width.transformId);
    expect(Object.keys(sources)).toHaveLength(2);
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

describe('authored callable link', () => {
  const link = Symbol.for('animus.transform.authored');
  // SAFETY: Animus forwarders define the link as a function-valued symbol property.
  const authoredOf = (fn: TransformFn) =>
    (fn as TransformFn & Record<symbol, TransformFn | undefined>)[link];

  it('reaches the authored function through every Animus forwarder, without changing them', () => {
    const authored = (v: string | number) => `${v}px`;
    const unit = createTransform('unit', authored);
    const rewrapped = createTransform('again', unit);
    const kit = createSystem()
      .addGroup('a', { gap: prop({ property: 'gap', transform: rewrapped }) })
      .build()
      .seal();
    const config = createSystem().extend(kit).build().system.toConfig();
    const id = JSON.parse(config.propConfig).gap.transformId;
    const forwarded = config.transforms[id];

    for (const forwarder of [unit, rewrapped, forwarded])
      expect(authoredOf(forwarder)).toBe(authored);
    expect(Object.isFrozen(forwarded)).toBe(true);
    expect(Object.keys(unit)).toEqual(['transformName', 'transformSource']);
    expect(JSON.parse(config.transformSources)[id]).toBe(authored.toString());
    expect(areTransformsEqual(unit, createTransform('unit', authored))).toBe(
      true
    );
  });
});
