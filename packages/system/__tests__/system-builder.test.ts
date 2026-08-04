import { describe, expect, it } from 'vitest';

import { createSystem, type Prop } from '../src';

function prop(overrides: Partial<Prop> = {}): Prop {
  return { property: 'margin', ...overrides };
}

describe('SystemBuilder prop overlap equality', () => {
  it('accepts equivalent ordered property targets', () => {
    const { system } = createSystem()
      .addGroup('first', {
        x: prop({ properties: ['marginLeft', 'marginRight'] }),
      })
      .addGroup('second', {
        x: prop({ properties: ['marginLeft', 'marginRight'] }),
      })
      .build();

    const config = system.toConfig();

    expect(JSON.parse(config.groupRegistry)).toEqual({
      first: ['x'],
      second: ['x'],
    });
    expect(JSON.parse(config.propConfig).x.properties).toEqual([
      'marginLeft',
      'marginRight',
    ]);
  });

  it('accepts equivalent ordered property targets from group to addProps', () => {
    const builder = createSystem()
      .addGroup('first', {
        x: prop({ properties: ['marginLeft', 'marginRight'] }),
      })
      .addProps({
        x: prop({ properties: ['marginLeft', 'marginRight'] }),
      });
    const config = builder.build().system.toConfig();

    expect(JSON.parse(config.groupRegistry)).toEqual({ first: ['x'] });
    expect(JSON.parse(config.propConfig)).toEqual({
      x: {
        property: 'margin',
        properties: ['marginLeft', 'marginRight'],
      },
    });
  });

  it.each([
    {
      field: 'property',
      existing: prop({ property: 'margin' }),
      incoming: prop({ property: 'padding' }),
    },
    {
      field: 'properties',
      existing: prop({ properties: ['marginLeft', 'marginRight'] }),
      incoming: prop({ properties: ['marginRight', 'marginLeft'] }),
    },
    {
      field: 'scale',
      existing: prop({ scale: 'space' }),
      incoming: prop({ scale: 'sizes' }),
    },
    {
      field: 'variable',
      existing: prop({ variable: '--first' }),
      incoming: prop({ variable: '--second' }),
    },
    {
      field: 'negative',
      existing: prop({ negative: true }),
      incoming: prop({ negative: false }),
    },
    {
      field: 'strict',
      existing: prop({ strict: true }),
      incoming: prop({ strict: false }),
    },
    {
      field: 'currentVar',
      existing: prop({ currentVar: '--first' }),
      incoming: prop({ currentVar: '--second' }),
    },
    {
      field: 'transform',
      existing: prop({ transform: (value) => value }),
      incoming: prop({ transform: (value) => String(value) }),
    },
  ])(
    'rejects an addGroup() overlap that differs in $field',
    ({ existing, incoming }) => {
      expect(() =>
        createSystem()
          .addGroup('first', { x: existing })
          .addGroup('second', { x: incoming })
      ).toThrow(/Prop "x"/);
    }
  );

  it('rejects a group-to-addProps() overlap that differs in currentVar', () => {
    expect(() =>
      createSystem()
        .addGroup('first', { x: prop({ currentVar: '--first' }) })
        .addProps({ x: prop({ currentVar: '--second' }) })
    ).toThrow(/Prop "x"/);
  });

  it('preserves object-scale identity semantics', () => {
    const firstScale = { sm: '4px' };
    const secondScale = { sm: '4px' };

    expect(() =>
      createSystem()
        .addGroup('first', { x: prop({ scale: firstScale }) })
        .addGroup('second', { x: prop({ scale: secondScale }) })
    ).toThrow(/Prop "x"/);
  });

  it('preserves array-scale identity semantics', () => {
    const firstScale = ['4px', '8px'] as const;
    const secondScale = ['4px', '8px'] as const;

    expect(() =>
      createSystem()
        .addGroup('first', { x: prop({ scale: firstScale }) })
        .addGroup('second', { x: prop({ scale: secondScale }) })
    ).toThrow(/Prop "x"/);
  });

  it.each([
    { kind: 'object', scale: { sm: '4px' } },
    { kind: 'array', scale: ['4px', '8px'] as const },
  ])('accepts a shared $kind scale reference', ({ scale }) => {
    const { system } = createSystem()
      .addGroup('first', { x: prop({ scale }) })
      .addGroup('second', { x: prop({ scale }) })
      .build();
    const config = system.toConfig();

    expect(JSON.parse(config.groupRegistry)).toEqual({
      first: ['x'],
      second: ['x'],
    });
    expect(JSON.parse(config.propConfig).x.scale).toEqual(scale);
  });
});

describe('SystemBuilder from()', () => {
  const buildKit = () =>
    createSystem()
      .addGroup('kitSurface', { kitGlow: prop({ property: 'boxShadow' }) })
      .build().system;

  it('does not merge the source registry — consumer stays singular authority', () => {
    const kitDs = buildKit();
    const withFrom = createSystem()
      .from(kitDs)
      .addGroup('space', { m: prop() })
      .build()
      .system.toConfig();
    const without = createSystem()
      .addGroup('space', { m: prop() })
      .build()
      .system.toConfig();

    expect(withFrom.propConfig).toEqual(without.propConfig);
    expect(withFrom.groupRegistry).toEqual(without.groupRegistry);
    expect(withFrom.selectorAliases).toEqual(without.selectorAliases);
    expect(withFrom.conditionAliases).toEqual(without.conditionAliases);
  });

  it('accepts a library bundle identically to the direct system half', () => {
    const kitDs = buildKit();
    const direct = createSystem()
      .from(kitDs)
      .addGroup('space', { m: prop() })
      .build()
      .system.toConfig();
    const viaBundle = createSystem()
      .from({ system: kitDs, tokens: { colors: { accent: '#f0f' } } })
      .addGroup('space', { m: prop() })
      .build()
      .system.toConfig();

    expect(viaBundle).toEqual(direct);
  });

  it('keeps the deprecated includes alias behaviorally identical to from()', () => {
    const kitDs = buildKit();
    const viaFrom = createSystem()
      .from(kitDs)
      .addGroup('space', { m: prop() })
      .build()
      .system.toConfig();
    const viaIncludes = createSystem({ includes: [kitDs] })
      .addGroup('space', { m: prop() })
      .build()
      .system.toConfig();

    expect(viaIncludes).toEqual(viaFrom);
  });
});
