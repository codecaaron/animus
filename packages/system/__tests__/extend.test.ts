import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  areTransformsEqual,
  createSystem,
  createTransform,
  type MapScale,
  type Prop,
  type RegistrySnapshot,
  type TransformFn,
} from '../src';
import { resolveValue } from '../src/runtime/resolveClasses';

function prop(overrides: Partial<Prop> = {}): Prop {
  return { property: 'margin', ...overrides };
}

function snapshotOf(system: {
  getRegistrySnapshot?(): RegistrySnapshot;
}): RegistrySnapshot {
  const snapshot = system.getRegistrySnapshot?.();
  if (!snapshot) {
    throw new Error('expected a built system to carry a registry snapshot');
  }
  return snapshot;
}

/**
 * Post-build mutation as a consumer performs it. `build()` hands back
 * key-exact registry types, so a name the builder chain never declared cannot
 * be written through them; `defineProperty` installs precisely the own,
 * enumerable, writable, configurable property a plain assignment would.
 */
function installUndeclaredEntry<Registry extends object>(
  registry: Registry,
  name: string,
  entry: Prop | readonly string[]
): void {
  Object.defineProperty(registry, name, {
    configurable: true,
    enumerable: true,
    value: entry,
    writable: true,
  });
}

/**
 * In-place growth of a registry member list whose declared element domain
 * (or `readonly` modifier) excludes the appended name: installing the next
 * index is exactly what `push` performs on an extensible array.
 */
function appendMember(members: readonly string[], member: string): void {
  Object.defineProperty(members, String(members.length), {
    configurable: true,
    enumerable: true,
    value: member,
    writable: true,
  });
}

/** `Prop.scale` carries the whole string/map/array union; the fixtures below
 *  mutate props they declared with an inline object scale. */
function isMapScale(scale: Prop['scale']): scale is MapScale {
  return Object.prototype.toString.call(scale) === '[object Object]';
}

describe('areTransformsEqual (design D12)', () => {
  const named = () => createTransform('px', (v) => `${v}px`);

  it('takes the identity fast path (including both-undefined)', () => {
    const t = named();
    expect(areTransformsEqual(t, t)).toBe(true);
    expect(areTransformsEqual(undefined, undefined)).toBe(true);
  });

  it('rejects a defined/undefined pair', () => {
    expect(areTransformsEqual(named(), undefined)).toBe(false);
    expect(areTransformsEqual(undefined, named())).toBe(false);
  });

  it('coalesces distinct named instances with equal name and captured source', () => {
    expect(areTransformsEqual(named(), named())).toBe(true);
  });

  it('rejects named transforms with equal names but divergent sources', () => {
    const a = createTransform('px', (v) => `${v}px`);
    const b = createTransform('px', (v) => `${v}rem`);
    expect(areTransformsEqual(a, b)).toBe(false);
  });

  it('rejects a name match when the captured source is missing on either side', () => {
    // Simulates an instance built by an older @animus-ui/system: named, but
    // no transformSource captured at creation.
    const legacyBody: TransformFn = (v) => `${v}px`;
    const legacy = Object.assign(legacyBody, { transformName: 'px' });
    expect(areTransformsEqual(named(), legacy)).toBe(false);
    expect(areTransformsEqual(legacy, named())).toBe(false);
  });

  it('rejects transforms with different names', () => {
    const a = createTransform('px', (v) => `${v}px`);
    const b = createTransform('rem', (v) => `${v}px`);
    expect(areTransformsEqual(a, b)).toBe(false);
  });

  it('compares bare-function pairs by their own source text', () => {
    const a: TransformFn = (value) => `0 0 ${value}px`;
    const b: TransformFn = (value) => `0 0 ${value}px`;
    const c: TransformFn = (value) => `0 0 ${value}rem`;
    expect(areTransformsEqual(a, b)).toBe(true);
    expect(areTransformsEqual(a, c)).toBe(false);
  });

  it('rejects a named/bare mix', () => {
    const bare: TransformFn = (v) => `${v}px`;
    expect(areTransformsEqual(named(), bare)).toBe(false);
    expect(areTransformsEqual(bare, named())).toBe(false);
  });
});

describe('SystemBuilder extend()', () => {
  const buildKit = () =>
    createSystem()
      .addGroup('layout', {
        gap: prop({ property: 'gap', scale: 'space' }),
      })
      .build().system;

  // Scenario: "Extended prop is present end to end" (runtime half; the type
  // half lives in types.test-d.tsx) + the G5 runtime witness.
  it('merges an extended prop into the built config end to end', () => {
    const kitDs = buildKit();
    const { system } = createSystem().extend(kitDs).build();
    const config = system.toConfig();

    // G5 witness: the type-admitted name is present in the runtime config.
    expect(Object.keys(JSON.parse(config.propConfig))).toContain('gap');
    expect(JSON.parse(config.propConfig).gap).toEqual(
      JSON.parse(kitDs.toConfig().propConfig).gap
    );
    expect(JSON.parse(config.groupRegistry)).toEqual({ layout: ['gap'] });
  });

  it('merges extended selectors and conditions into the serialized config', () => {
    const kitDs = createSystem()
      .addSelectors({ _cardHover: '&[data-card]:hover' })
      .addConditions({ _compact: '@media (max-width: 400px)' })
      .build().system;
    const config = createSystem().extend(kitDs).build().system.toConfig();

    expect(JSON.parse(config.selectorAliases)._cardHover).toBe(
      '&[data-card]:hover'
    );
    expect(JSON.parse(config.conditionAliases)._compact).toMatchObject({
      value: '@media (max-width: 400px)',
      kind: 'media',
    });
  });

  it('adopts a kit override of a built-in selector, preserving its order', () => {
    const kitDs = createSystem()
      .addSelectors({ _hover: '&:hover:not([data-frozen])' })
      .build().system;
    const config = createSystem().extend(kitDs).build().system.toConfig();

    expect(JSON.parse(config.selectorAliases)._hover).toBe(
      '&:hover:not([data-frozen])'
    );
  });

  // Inc-12 F7 witness: selector order allocation CONTINUES past the existing
  // maximum across successive merges (mirrors mergeConditions) — two kits
  // each contributing one alias must never share order 500, and allocation
  // is deterministic under either extension order (no conflict exists, so
  // both orderings build).
  it('allocates distinct selector orders across repeated extends, stable under re-ordering', () => {
    const kitA = createSystem()
      .addSelectors({ _cardHover: '&[data-card]:hover' })
      .build().system;
    const kitB = createSystem()
      .addSelectors({ _railOpen: '&[data-rail][data-open]' })
      .build().system;

    const ab = snapshotOf(
      createSystem().extend(kitA).extend(kitB).build().system
    ).selectors;
    const ba = snapshotOf(
      createSystem().extend(kitB).extend(kitA).build().system
    ).selectors;

    // Distinct orders in both orderings — the F7 failure mode was both
    // aliases landing on order 500.
    expect(ab._cardHover.order).not.toBe(ab._railOpen.order);
    expect(ba._railOpen.order).not.toBe(ba._cardHover.order);

    // Stable, deterministic allocation: the first-extended alias takes the
    // 500 slot, the next continues at 510 — under either call order.
    expect(ab._cardHover.order).toBe(500);
    expect(ab._railOpen.order).toBe(510);
    expect(ba._railOpen.order).toBe(500);
    expect(ba._cardHover.order).toBe(510);
  });

  // Same F7 seam, builder-chain half: successive addSelectors calls on one
  // chain continue numbering instead of restarting at 500.
  it('continues selector order allocation across chained addSelectors calls', () => {
    const { system } = createSystem()
      .addSelectors({ _chainOne: '&[data-chain-one]' })
      .addSelectors({ _chainTwo: '&[data-chain-two]' })
      .build();
    const selectors = snapshotOf(system).selectors;
    expect(selectors._chainOne.order).toBe(500);
    expect(selectors._chainTwo.order).toBe(510);
  });

  // Scenario: "Bundle object feeds the system half".
  it('consumes the system half of a bundle and ignores the theme half', () => {
    const kitDs = buildKit();
    const direct = createSystem().extend(kitDs).build().system.toConfig();
    const viaTheme = createSystem()
      .extend({ system: kitDs, theme: { colors: { accent: '#f0f' } } })
      .build()
      .system.toConfig();
    const viaTokens = createSystem()
      .extend({ system: kitDs, tokens: { colors: { accent: '#f0f' } } })
      .build()
      .system.toConfig();

    expect(viaTheme).toEqual(direct);
    expect(viaTokens).toEqual(direct);
  });

  it('fails loud when the source carries no registry snapshot', () => {
    const kitDs = buildKit();
    const legacy = { toConfig: () => kitDs.toConfig() };
    expect(() => createSystem().extend({ system: legacy })).toThrow(
      /older @animus-ui\/system/
    );
  });

  // Scenario: "Identical definitions coalesce".
  it('coalesces byte-equivalent definitions from source and consumer', () => {
    const kitDs = createSystem()
      .addProps({ m: prop({ scale: 'space' }) })
      .build().system;
    const { system } = createSystem()
      .extend(kitDs)
      .addProps({ m: prop({ scale: 'space' }) })
      .build();

    expect(JSON.parse(system.toConfig().propConfig)).toEqual({
      m: { property: 'margin', scale: 'space' },
    });
  });

  // Scenario: "Divergent prop definition fails" — the consumer's own chain
  // diverging from an extended definition fails naming the prop, both scale
  // bindings, and both origins.
  it('fails a consumer addProps that diverges from an extended prop, naming both origins', () => {
    const kitDs = buildKit();
    expect(() =>
      createSystem()
        .extend(kitDs)
        .addProps({ gap: prop({ property: 'gap', scale: 'sizes' }) })
    ).toThrow(
      /Prop "gap".*Existing \(extended source #1\): property="gap", scale="space".*Incoming \(builder state\): property="gap", scale="sizes"/
    );
  });

  it('fails a consumer addGroup that diverges from an extended prop, naming both origins', () => {
    const kitDs = buildKit();
    expect(() =>
      createSystem()
        .extend(kitDs)
        .addGroup('spacing', { gap: prop({ property: 'gap', scale: 'sizes' }) })
    ).toThrow(/extended source #1.*builder state/s);
  });

  // Scenario: "Sibling sources conflict loudly" (G4, selector half) —
  // order-independent, naming both extended sources.
  it('fails divergent sibling selector aliases naming both sources, order-independent', () => {
    const kitA = createSystem()
      .addSelectors({ _hover: '&:hover:not([data-frozen])' })
      .build().system;
    const kitB = createSystem()
      .addSelectors({ _hover: '&:hover, &[data-hover]' })
      .build().system;

    expect(() => createSystem().extend(kitA).extend(kitB)).toThrow(
      /selector alias "_hover".*extended source #1.*extended source #2/s
    );
    expect(() => createSystem().extend(kitB).extend(kitA)).toThrow(
      /selector alias "_hover".*extended source #1.*extended source #2/s
    );
  });

  // G4 (prop half): sibling divergence and dual-version divergence.
  it('fails divergent sibling prop definitions naming both sources, order-independent', () => {
    const kitA = createSystem()
      .addProps({ gap: prop({ property: 'gap', scale: 'space' }) })
      .build().system;
    const kitB = createSystem()
      .addProps({ gap: prop({ property: 'gap', scale: 'sizes' }) })
      .build().system;

    expect(() => createSystem().extend(kitA).extend(kitB)).toThrow(
      /Prop "gap".*Existing \(extended source #1\).*Incoming \(extended source #2\)/
    );
    expect(() => createSystem().extend(kitB).extend(kitA)).toThrow(
      /Prop "gap".*Existing \(extended source #1\).*Incoming \(extended source #2\)/
    );
  });

  it('fails one package present as two divergent instances, identifying both', () => {
    // Simulates the same kit at two versions: same names, divergent values.
    const v1 = createSystem()
      .addProps({ gap: prop({ property: 'gap', scale: 'space' }) })
      .build().system;
    const v2 = createSystem()
      .addProps({ gap: prop({ property: 'gap', scale: 'spacing' }) })
      .build().system;

    expect(() => createSystem().extend(v1).extend(v2)).toThrow(
      /extended source #1.*extended source #2/s
    );
  });

  it('fails divergent sibling condition aliases naming both sources', () => {
    const kitA = createSystem()
      .addConditions({ _compact: '@media (max-width: 400px)' })
      .build().system;
    const kitB = createSystem()
      .addConditions({ _compact: '@media (max-width: 500px)' })
      .build().system;

    expect(() => createSystem().extend(kitA).extend(kitB)).toThrow(
      /condition alias "_compact".*extended source #1.*extended source #2/s
    );
  });

  it('fails divergent sibling group membership naming both sources', () => {
    const kitA = createSystem()
      .addGroup('layout', { gap: prop({ property: 'gap' }) })
      .build().system;
    const kitB = createSystem()
      .addGroup('layout', {
        gap: prop({ property: 'gap' }),
        rowGap: prop({ property: 'rowGap' }),
      })
      .build().system;

    expect(() => createSystem().extend(kitA).extend(kitB)).toThrow(
      /group "layout".*Existing \(extended source #1\): \[gap\].*Incoming \(extended source #2\): \[gap, rowGap\]/
    );
  });

  it('fails cross-registry name collisions between extended sources, both directions', () => {
    const conditionKit = createSystem()
      .addConditions({ _compact: '@media (max-width: 400px)' })
      .build().system;
    const selectorKit = createSystem()
      .addSelectors({ _compact: '&[data-compact]' })
      .build().system;

    expect(() =>
      createSystem().extend(conditionKit).extend(selectorKit)
    ).toThrow(/selector alias "_compact".*registered as a condition alias/s);
    expect(() =>
      createSystem().extend(selectorKit).extend(conditionKit)
    ).toThrow(/condition alias "_compact".*registered as a selector alias/s);
  });

  it('fails group-name-vs-prop-name cross-collisions between extended sources', () => {
    const propKit = createSystem()
      .addProps({ card: prop({ property: 'gridArea' }) })
      .build().system;
    const groupKit = createSystem()
      .addGroup('card', { cardPad: prop({ property: 'padding' }) })
      .build().system;

    expect(() => createSystem().extend(propKit).extend(groupKit)).toThrow(
      /group name "card".*collides with an existing prop name/
    );
    expect(() => createSystem().extend(groupKit).extend(propKit)).toThrow(
      /prop "card".*collides with an existing group name/
    );
  });

  // Cached-instance coalesce: semantic function equality cannot be inferred
  // from source text because equal-looking functions may capture different
  // closure values.
  it('coalesces repeated extension of one cached kit instance', () => {
    const buildDualKit = () =>
      createSystem()
        .addGroup('surface', {
          px: prop({
            property: 'paddingLeft',
            transform: createTransform('px', (v) => `${v}px`),
          }),
          glow: prop({
            property: 'boxShadow',
            transform: (value) => `0 0 ${value}px`,
          }),
        })
        .addSelectors({ _cardHover: '&[data-card]:hover' })
        .addConditions({ _compact: '@media (max-width: 400px)' })
        .build().system;

    const kit = buildDualKit();
    const once = createSystem().extend(kit).build().system.toConfig();
    const twice = createSystem()
      .extend(kit)
      .extend(kit)
      .build()
      .system.toConfig();

    // `transforms` carries live function references (distinct per kit
    // instance), so the serialized fields and the transform key set are the
    // comparable surface.
    expect(twice.propConfig).toEqual(once.propConfig);
    expect(twice.groupRegistry).toEqual(once.groupRegistry);
    expect(twice.selectorAliases).toEqual(once.selectorAliases);
    expect(twice.conditionAliases).toEqual(once.conditionAliases);
    expect(Object.keys(twice.transforms)).toEqual(Object.keys(once.transforms));
  });

  // D12's documented accepted residual (inc-02 review F3): byte-identical
  // source with divergent closure captures COALESCES — source text is the
  // cross-instance identity, and the closure environment is invisible to it.
  // The first-registered instance wins. Pinned so the trade-off stays
  // deliberate; the loud alternative (identity-only) was tried in-tree and
  // reverted (false-conflicts every dual-install, forbids re-registration).
  it('coalesces equal-source transforms that capture different closure values (documented residual)', () => {
    const buildUnitKit = (unit: string) =>
      createSystem()
        .addProps({
          size: prop({
            property: 'width',
            transform: createTransform('unit', (value) => `${value}${unit}`),
          }),
        })
        .build().system;

    const { system } = createSystem()
      .extend(buildUnitKit('px'))
      .extend(buildUnitKit('rem'))
      .build();
    const config = system.toConfig();
    expect(JSON.parse(config.propConfig).size.transform).toBe('unit');
    // First-registered wins: the 'px' capture is the surviving behavior.
    expect(config.transforms.unit(4)).toBe('4px');
  });

  it('coalesces structurally equal inline object and array scales', () => {
    const buildScaledKit = () =>
      createSystem()
        .addProps({
          mapped: prop({ scale: { sm: '4px', lg: '8px' } }),
          listed: prop({ scale: ['4px', '8px'] }),
        })
        .build().system;

    expect(() =>
      createSystem().extend(buildScaledKit()).extend(buildScaledKit()).build()
    ).not.toThrow();
  });

  it('rejects two props that serialize different transforms under one name', () => {
    const first = createTransform('shared', (value) => `A:${value}`);
    const second = createTransform('shared', (value) => `B:${value}`);
    expect(() =>
      createSystem()
        .addProps({
          first: prop({ transform: first }),
          second: prop({ transform: second }),
        })
        .build()
        .system.toConfig()
    ).toThrow(/Transform name "shared".*"first".*"second"/);
  });

  // Scenario: "Anonymous transform survives extension" (G7) — serialization
  // would have dropped it; the snapshot-based merge must not.
  it('carries an anonymous transform through extension and applies it identically', () => {
    // Truly anonymous: an arrow assigned to a binding (or object property)
    // gets an inferred fn.name, which serializeInstance would treat as a
    // usable name — returning it from a factory keeps fn.name === ''.
    const makeGlow = () => (value: string | number) => `0 0 ${value}px`;
    const glowTransform = makeGlow();
    expect(glowTransform.name).toBe('');
    const kitDs = createSystem()
      .addProps({
        glow: prop({ property: 'boxShadow', transform: glowTransform }),
      })
      .build().system;

    // The serialized form drops the unnamed transform — reconstruction from
    // toConfig() would lose it (the G7 failure mode).
    const serialized = kitDs.toConfig();
    expect(JSON.parse(serialized.propConfig).glow.transform).toBeUndefined();
    expect(serialized.transforms).toEqual({});

    const { system: merged } = createSystem().extend(kitDs).build();
    const mergedTransform = snapshotOf(merged).props.glow.transform;
    expect(mergedTransform).not.toBe(glowTransform);
    // Styled-output application through the runtime resolution path matches
    // the source system exactly.
    expect(
      resolveValue(4, { varName: '--glow', transform: glowTransform })
    ).toBe('0 0 4px');
    expect(mergedTransform?.(4)).toBe(
      snapshotOf(kitDs).props.glow.transform?.(4)
    );
  });

  // Scenario: "Post-build mutation does not leak" + snapshot immutability.
  it('ignores post-build registry mutation in toConfig() and extension', () => {
    const { system } = createSystem()
      .addGroup('space', { m: prop({ scale: 'space' }) })
      .build();
    const before = system.toConfig();

    installUndeclaredEntry(system.propRegistry, 'rogue', {
      property: 'color',
    });
    system.propRegistry.m.scale = 'sizes';
    appendMember(system.groupRegistry.space, 'rogue');

    // The mutation has to LAND on the public fields, or every assertion below
    // would hold for the wrong reason.
    expect(system.propRegistry).toHaveProperty('rogue');
    expect(system.propRegistry.m.scale).toBe('sizes');
    expect(system.groupRegistry.space).toEqual(['m', 'rogue']);

    expect(system.toConfig()).toEqual(before);

    const consumer = createSystem().extend(system).build().system.toConfig();
    expect(JSON.parse(consumer.propConfig)).toEqual({
      m: { property: 'margin', scale: 'space' },
    });
    expect(JSON.parse(consumer.groupRegistry)).toEqual({ space: ['m'] });
  });

  // Review probe P9 (inc 12): build() hands the instance shallow-copied
  // registry containers, so instance-field mutation cannot reach the
  // builder's private state — a second build() on the same builder must not
  // bake the mutation into its snapshot.
  it('keeps a rebuild pristine after instance-field mutation of a prior build (P9)', () => {
    const builder = createSystem().addGroup('space', {
      m: prop({ scale: 'space' }),
    });
    const { system: first } = builder.build();
    const before = first.toConfig();

    installUndeclaredEntry(first.propRegistry, 'rogue', {
      property: 'color',
    });
    installUndeclaredEntry(first.groupRegistry, 'rogueGroup', ['rogue']);
    // Entry-depth mutation (review probe P9, second pass): a field inside a
    // shared Prop entry must not reach a later build either.
    first.propRegistry.m.scale = 'sizes';
    appendMember(first.groupRegistry.space, 'rogue');

    // Precondition: the first instance really is mutated, so a pristine
    // rebuild below is evidence rather than an accident.
    expect(first.propRegistry).toHaveProperty('rogue');
    expect(first.groupRegistry).toHaveProperty('rogueGroup');
    expect(first.propRegistry.m.scale).toBe('sizes');
    expect(first.groupRegistry.space).toEqual(['m', 'rogue']);

    const { system: second } = builder.build();
    const after = second.toConfig();
    expect(JSON.parse(after.propConfig)).not.toHaveProperty('rogue');
    expect(JSON.parse(after.groupRegistry)).not.toHaveProperty('rogueGroup');
    expect(JSON.parse(after.propConfig).m.scale).toBe('space');
    expect(JSON.parse(after.groupRegistry).space).toEqual(['m']);
    expect(after).toEqual(before);
  });

  it('ignores post-build mutation of nested properties arrays and object scales', () => {
    const { system } = createSystem()
      .addGroup('space', {
        mx: prop({
          property: 'margin',
          properties: ['marginLeft', 'marginRight'],
          scale: { sm: '4px' },
        }),
      })
      .build();
    const before = system.toConfig();

    const { properties, scale } = system.propRegistry.mx;
    if (properties === undefined || !isMapScale(scale)) {
      throw new TypeError(
        'the mx fixture declares member properties and an object scale'
      );
    }
    appendMember(properties, 'marginTop');
    scale.sm = '999px';

    // Precondition: both nested containers really were mutated in place.
    expect(system.propRegistry.mx.properties).toEqual([
      'marginLeft',
      'marginRight',
      'marginTop',
    ]);
    expect(system.propRegistry.mx.scale).toEqual({ sm: '999px' });

    expect(system.toConfig()).toEqual(before);

    const consumer = createSystem().extend(system).build().system.toConfig();
    const mx = JSON.parse(consumer.propConfig).mx;
    expect(mx.properties).toEqual(['marginLeft', 'marginRight']);
    expect(mx.scale).toEqual({ sm: '4px' });
  });

  it('captures transform serialization metadata at build time', () => {
    const transform = createTransform('stable', (value) => `${value}px`);
    const { system } = createSystem()
      .addProps({ width: prop({ property: 'width', transform }) })
      .build();
    const before = system.toConfig();

    transform.transformName = 'changed';

    expect(system.toConfig()).toEqual(before);
    expect(JSON.parse(system.toConfig().propConfig).width.transform).toBe(
      'stable'
    );
  });

  it('freezes the registry snapshot containers and entries', () => {
    const { system } = createSystem()
      .addGroup('space', { m: prop({ scale: 'space' }) })
      .build();
    const snapshot = snapshotOf(system);

    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.props)).toBe(true);
    expect(Object.isFrozen(snapshot.props.m)).toBe(true);
    expect(Object.isFrozen(snapshot.groups)).toBe(true);
    expect(Object.isFrozen(snapshot.groups.space)).toBe(true);
    expect(Object.isFrozen(snapshot.selectors)).toBe(true);
    expect(Object.isFrozen(snapshot.selectors._hover)).toBe(true);
    expect(Object.isFrozen(snapshot.conditions)).toBe(true);
    expect(Object.isFrozen(snapshot.conditions._motionReduce)).toBe(true);
  });
});

describe('deprecated extension aliases (frozen semantics)', () => {
  const buildKit = () =>
    createSystem()
      .addGroup('kitSurface', { kitGlow: prop({ property: 'boxShadow' }) })
      .build().system;

  // Scenario: "from() behavior is unchanged during the window" — byte-identical
  // to a builder that never called from() (no registry merge).
  it('keeps from() merge-free and byte-identical during the deprecation window', () => {
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

  // Scenario: "Deprecation is visible to consumers" — the published types are
  // emitted from these docblocks, so the source-level tags are the witness.
  it('marks from() and includes as deprecated pointing at extend()', () => {
    // NOT `new URL(relative, import.meta.url)` — Vite rewrites that pattern
    // into a non-file asset URL under the test runner.
    const builderSource = readFileSync(
      resolve(fileURLToPath(import.meta.url), '../../src/SystemBuilder.ts'),
      'utf8'
    );

    const fromDeprecations = builderSource.match(
      /@deprecated Use `extend\(source\)`/g
    );
    expect(fromDeprecations?.length).toBeGreaterThanOrEqual(2);
    expect(builderSource).toMatch(
      /@deprecated Use `createSystem\(\)\.extend\(source\)`/
    );
  });
});
