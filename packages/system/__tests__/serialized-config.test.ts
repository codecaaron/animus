import { describe, expect, it } from 'vitest';

import { createSystem, createTransform, type Prop } from '../src';

/**
 * ────────────────────────────────────────────────────────────────────────────
 * SERIALIZATION CONTRACT — DO NOT LOOSEN CASUALLY
 * ────────────────────────────────────────────────────────────────────────────
 *
 * This file pins the exact shape produced by `serializeInstance` in
 * `packages/system/src/SystemBuilder.ts` (the body of `system.toConfig()`).
 *
 * That output — `propConfig`, `groupRegistry`, `transforms`, `selectorAliases`
 * — is MIRROR-PARSED by the Rust extractor in `packages/extract`. The two sides
 * form a hand-maintained wire contract: the TS side emits these fields, the Rust
 * side deserializes them by name. RepoWise shows SystemBuilder co-changes with
 * ~24 files precisely because this contract fans out.
 *
 * Any accidental field RENAME / REMOVAL / ADDITION here must break this test
 * loudly BEFORE it silently desynchronizes the Rust parser. If you are changing
 * the shape ON PURPOSE, that is a coordinated cross-language change:
 *   1. Update `serializeInstance` in SystemBuilder.ts.
 *   2. Update the mirror deserializer in packages/extract (the Rust side that
 *      reads propConfig / groupRegistry / selectorAliases JSON).
 *   3. Update the change-type map's `extract` rows so the coupling is recorded.
 *   4. Update this test's golden literal to match the new shape.
 *
 * NOTE ON WHAT IS *NOT* EMITTED: `Prop` carries `strict` and `variable` fields
 * (used for type-level narrowing and equality checks), but `serializeInstance`
 * DELIBERATELY does not serialize them — they never reach the extractor. The
 * tests below assert their absence so a future "just serialize the whole Prop"
 * refactor cannot leak them into the wire shape unnoticed.
 *
 * NOTE ON THEME-SIDE FIELDS: `scalesJson` / `variableMapJson` / `variableCss` /
 * `contextualVarsJson` are the *theme* contract (`tokens.serialize()` →
 * `SerializedTheme`) and do NOT flow through `serializeInstance`. This file
 * pins the SYSTEM contract only; those four fields intentionally do not appear.
 */

// The complete built-in selector-alias contract, in cascade (order-index) order.
// `selectorAliases` is `JSON.stringify` of exactly this map for any system that
// does not register custom selectors. A rename/removal of any built-in alias, or
// a change to any selector string, must fail the golden deep-equal below.
const BUILT_IN_SELECTOR_ALIASES: Record<string, string> = {
  _link: '&:link',
  _visited: '&:visited',
  _hover: '&:hover',
  _focusWithin: '&:focus-within',
  _focus: '&:focus',
  _focusVisible: '&:focus-visible',
  _active: '&:active',
  _target: '&:target',
  _checked: '&:checked, &[aria-checked="true"], &[data-checked]',
  _invalid: '&:invalid, &[aria-invalid="true"], &[data-invalid]',
  _required: '&:required, &[aria-required="true"]',
  _readOnly: '&:read-only, &[aria-readonly="true"], &[data-readonly]',
  _expanded: '&[aria-expanded="true"], &[data-expanded]',
  _selected: '&[aria-selected="true"], &[data-selected]',
  _pressed: '&[aria-pressed="true"], &[data-pressed]',
  _disabled:
    '&:disabled, &[disabled], &[aria-disabled="true"], &[data-disabled]',
  _before: '&::before',
  _after: '&::after',
  _placeholder: '&::placeholder',
  _selection: '&::selection',
  _first: '&:first-child',
  _last: '&:last-child',
  _even: '&:nth-child(even)',
  _odd: '&:nth-child(odd)',
  _empty: '&:empty',
};

// The complete built-in CONDITION-alias contract, in cascade (order-index)
// order (modern-css-surface inc 06, design D8). `conditionAliases` is
// `JSON.stringify` of exactly this map for any system that registers no
// conditions — the "No user registrations serializes exactly the built-in set"
// spec scenario. Built-ins occupy the reserved order band 300–380 (BELOW the
// user band, which starts at 500 via mergeConditions' 490 floor). A
// rename/removal of any built-in alias, an order shift, or a query change must
// fail the golden deep-equals below.
const BUILT_IN_CONDITION_ALIASES: Record<
  string,
  { value: string; order: number; kind: string }
> = {
  _motionReduce: {
    value: '@media (prefers-reduced-motion: reduce)',
    order: 300,
    kind: 'media',
  },
  _motionSafe: {
    value: '@media (prefers-reduced-motion: no-preference)',
    order: 310,
    kind: 'media',
  },
  _print: { value: '@media print', order: 320, kind: 'media' },
  _portrait: {
    value: '@media (orientation: portrait)',
    order: 330,
    kind: 'media',
  },
  _landscape: {
    value: '@media (orientation: landscape)',
    order: 340,
    kind: 'media',
  },
  _moreContrast: {
    value: '@media (prefers-contrast: more)',
    order: 350,
    kind: 'media',
  },
  _lessContrast: {
    value: '@media (prefers-contrast: less)',
    order: 360,
    kind: 'media',
  },
  _osDark: {
    value: '@media (prefers-color-scheme: dark)',
    order: 370,
    kind: 'media',
  },
  _osLight: {
    value: '@media (prefers-color-scheme: light)',
    order: 380,
    kind: 'media',
  },
};

/**
 * A system that exercises EVERY serialized prop feature:
 * - a group (`layout`) so `groupRegistry` is non-empty,
 * - a named transform (`px`) so `transforms` and the `transform` string field
 *   are populated,
 * - `scale` in both string form (`m`) and inline-object form (`size`),
 * - `negative`, `properties[]`, and `currentVar`,
 * - a standalone `addProps` prop (`ratio`) which lands in `propConfig` but NOT
 *   in `groupRegistry`,
 * - a custom selector alias (`_brand`),
 * - AND a prop carrying `strict` + `variable`, both of which must be dropped.
 */
function buildFeatureSystem() {
  const px = createTransform('px', (value) =>
    typeof value === 'number' ? `${value}px` : value
  );

  const { system } = createSystem()
    .addGroup('layout', {
      m: {
        property: 'margin',
        scale: 'space',
        transform: px,
        negative: true,
        strict: false, // must NOT be serialized
        variable: '--m', // must NOT be serialized
      } as Prop,
      size: {
        property: 'width',
        properties: ['width', 'height'],
        scale: { sm: '4px', lg: '8px' },
        currentVar: '--size',
      } as Prop,
    })
    .addProps({
      ratio: { property: 'aspectRatio' } as Prop,
    })
    .addSelectors({ _brand: '&[data-brand]' })
    .build();

  return system.toConfig();
}

describe('serializeInstance contract', () => {
  it('emits exactly five top-level keys', () => {
    const config = buildFeatureSystem();

    // ASSERTION 1: the exact top-level key set of SerializedConfig. The
    // `conditionAliases` field was ADDED in the modern-css-surface change
    // (inc 03) as a coordinated cross-language field — the Rust extractor
    // mirror-parses it. `selectorAliases` is UNCHANGED alongside it.
    expect(Object.keys(config).sort()).toEqual([
      'conditionAliases',
      'groupRegistry',
      'propConfig',
      'selectorAliases',
      'transforms',
    ]);

    // Carrier types: four are JSON *strings*, transforms is a live JS object.
    expect(typeof config.propConfig).toBe('string');
    expect(typeof config.groupRegistry).toBe('string');
    expect(typeof config.selectorAliases).toBe('string');
    expect(typeof config.conditionAliases).toBe('string');
    expect(typeof config.transforms).toBe('object');
  });

  it('pins the field set and value types of every propConfig entry', () => {
    const propConfig = JSON.parse(buildFeatureSystem().propConfig) as Record<
      string,
      Record<string, unknown>
    >;

    // ASSERTION 2: exact per-entry field sets (sorted) + value types.
    expect(Object.keys(propConfig).sort()).toEqual(['m', 'ratio', 'size']);

    // `m` — string scale + named transform + negative flag.
    expect(Object.keys(propConfig.m).sort()).toEqual([
      'negative',
      'property',
      'scale',
      'transform',
    ]);
    expect(typeof propConfig.m.property).toBe('string');
    expect(typeof propConfig.m.scale).toBe('string');
    expect(typeof propConfig.m.negative).toBe('boolean');
    expect(propConfig.m.negative).toBe(true);
    expect(typeof propConfig.m.transform).toBe('string');
    // transform serializes to the transform's NAME, not the function body.
    expect(propConfig.m.transform).toBe('px');

    // `size` — array `properties`, inline object scale, currentVar.
    expect(Object.keys(propConfig.size).sort()).toEqual([
      'currentVar',
      'properties',
      'property',
      'scale',
    ]);
    expect(typeof propConfig.size.property).toBe('string');
    expect(Array.isArray(propConfig.size.properties)).toBe(true);
    expect(propConfig.size.properties).toEqual(['width', 'height']);
    expect(typeof propConfig.size.scale).toBe('object');
    expect(propConfig.size.scale).toEqual({ sm: '4px', lg: '8px' });
    expect(typeof propConfig.size.currentVar).toBe('string');

    // `ratio` — minimal prop: only `property`.
    expect(Object.keys(propConfig.ratio)).toEqual(['property']);
    expect(typeof propConfig.ratio.property).toBe('string');

    // Negative guard: `strict` and `variable` must NEVER be serialized.
    for (const entry of Object.values(propConfig)) {
      expect(entry).not.toHaveProperty('strict');
      expect(entry).not.toHaveProperty('variable');
    }
  });

  it('maps each group name to its exact ordered prop-name array', () => {
    const config = buildFeatureSystem();

    // ASSERTION 3: groupRegistry is group name → prop-name array. Props added
    // via addProps (`ratio`) are NOT members of any group.
    expect(JSON.parse(config.groupRegistry)).toEqual({
      layout: ['m', 'size'],
    });
  });

  it('registers named transforms as live, callable functions', () => {
    const config = buildFeatureSystem();

    // transforms is the ONE field that is not JSON: it carries live functions
    // through to the extraction subprocess. Keys mirror the `transform` string
    // in propConfig; values must remain invocable.
    expect(Object.keys(config.transforms)).toEqual(['px']);
    expect(typeof config.transforms.px).toBe('function');
    expect(config.transforms.px(4)).toBe('4px');
    expect(config.transforms.px('auto')).toBe('auto');
  });

  it('serializes the full built-in selector alias map', () => {
    const config = buildFeatureSystem();
    const selectors = JSON.parse(config.selectorAliases) as Record<
      string,
      string
    >;

    // All built-ins are present and unchanged, plus the custom `_brand` alias.
    expect(selectors).toEqual({
      ...BUILT_IN_SELECTOR_ALIASES,
      _brand: '&[data-brand]',
    });
  });

  it('matches the complete golden serialized output for a minimal two-prop system', () => {
    // A deliberately minimal system: one group, two string-scale props, no
    // transforms, no custom selectors. Its ENTIRE serialized output is pinned
    // as an inline golden literal below. This is the load-bearing contract the
    // Rust extractor (packages/extract) mirror-parses; see the file header for
    // the coordinated cross-language change procedure required to modify it.
    const { system } = createSystem()
      .addGroup('space', {
        m: { property: 'margin', scale: 'space' } as Prop,
        p: { property: 'padding', scale: 'space' } as Prop,
      })
      .build();

    const config = system.toConfig();

    // Normalize the wire form: parse the four JSON-string fields, keep the
    // live `transforms` object as-is (it is `{}` for a transform-free system).
    const normalized = {
      propConfig: JSON.parse(config.propConfig),
      groupRegistry: JSON.parse(config.groupRegistry),
      transforms: config.transforms,
      selectorAliases: JSON.parse(config.selectorAliases),
      conditionAliases: JSON.parse(config.conditionAliases),
    };

    // ASSERTION 4: one full deep-equal against the golden literal. A system
    // that registers no conditions serializes exactly the BUILT-IN condition
    // set (built-in conditions ship as of inc 06 — design D8); `selectorAliases`
    // is unchanged. Guardrail G1: every field except `conditionAliases` is
    // byte-identical to the pre-condition-support output.
    expect(normalized).toEqual({
      propConfig: {
        m: { property: 'margin', scale: 'space' },
        p: { property: 'padding', scale: 'space' },
      },
      groupRegistry: {
        space: ['m', 'p'],
      },
      transforms: {},
      selectorAliases: BUILT_IN_SELECTOR_ALIASES,
      conditionAliases: BUILT_IN_CONDITION_ALIASES,
    });
  });

  it('serializes registered condition aliases as { value, order, kind } and leaves selectorAliases byte-identical', () => {
    // WITHOUT any condition registration: conditionAliases is EXACTLY the
    // built-in set (inc 06 — design D8), and selectorAliases is exactly the
    // built-in selector set (byte-for-byte).
    const { system: bare } = createSystem()
      .addSelectors({ _brand: '&[data-brand]' })
      .build();
    const bareConfig = bare.toConfig();
    expect(JSON.parse(bareConfig.conditionAliases)).toEqual(
      BUILT_IN_CONDITION_ALIASES
    );

    // WITH condition registration across all three kinds. `addConditions`
    // infers `kind` from the at-rule prefix and assigns cascade `order` in
    // registration sequence — NEW aliases allocate in the user band (500+,
    // floored past the built-in 300–380 band), parallel to
    // `addSelectors`/`mergeSelectors`. `_motionReduce` is a built-in, so
    // registering it (identical value) OVERRIDES in place, preserving its
    // built-in order 300 rather than allocating a new one.
    const { system: withConds } = createSystem()
      .addSelectors({ _brand: '&[data-brand]' })
      .addConditions({
        _motionReduce: '@media (prefers-reduced-motion: reduce)',
        _cardSm: '@container card (min-width: 400px)',
        _hasGrid: '@supports (display: grid)',
      })
      .build();
    const condConfig = withConds.toConfig();

    expect(JSON.parse(condConfig.conditionAliases)).toEqual({
      // built-ins carried through, `_motionReduce` overridden in place (same
      // value, built-in order 300 preserved)
      ...BUILT_IN_CONDITION_ALIASES,
      // new user aliases land in the user band, starting at 500
      _cardSm: {
        value: '@container card (min-width: 400px)',
        order: 500,
        kind: 'container',
      },
      _hasGrid: {
        value: '@supports (display: grid)',
        order: 510,
        kind: 'supports',
      },
    });

    // LOAD-BEARING PROOF (inc 03 output contract): registering conditions does
    // NOT perturb the serialized selector map — same bytes with and without.
    expect(condConfig.selectorAliases).toBe(bareConfig.selectorAliases);
  });

  it('serializes exactly the built-in condition set for a system that registers no conditions', () => {
    // Spec scenario (selector-alias-registry §"No user registrations serializes
    // exactly the built-in set"): the manifest's condition map contains exactly
    // the built-in condition alias set, and every other manifest field is
    // byte-identical to the pre-condition-support output (Guardrail G1).
    const { system } = createSystem()
      .addGroup('space', {
        m: { property: 'margin', scale: 'space' } as Prop,
      })
      .build();
    const config = system.toConfig();
    expect(JSON.parse(config.conditionAliases)).toEqual(
      BUILT_IN_CONDITION_ALIASES
    );
    // selectorAliases still the bare built-in set (no custom selectors here).
    expect(JSON.parse(config.selectorAliases)).toEqual(
      BUILT_IN_SELECTOR_ALIASES
    );
  });

  it('lets a user condition alias override a built-in of the same name, preserving the built-in order', () => {
    // Spec scenario (selector-alias-registry §"Override a built-in condition
    // alias"): `_print` is a BUILT-IN at order 320. Re-registering it replaces
    // the value while preserving the built-in cascade order (mirrors
    // mergeSelectors override) — the override does NOT reallocate into the user
    // band, so it never reorders relative to sibling built-ins.
    const { system } = createSystem()
      .addConditions({ _print: '@media print and (min-resolution: 300dpi)' })
      .build();
    const conditions = JSON.parse(system.toConfig().conditionAliases) as Record<
      string,
      { value: string; order: number; kind: string }
    >;
    expect(conditions._print.value).toBe(
      '@media print and (min-resolution: 300dpi)'
    );
    // built-in order 320 preserved, NOT a fresh 500-band order
    expect(conditions._print.order).toBe(320);
    // exactly one _print entry — override replaces, never appends
    const printEntries = Object.keys(conditions).filter((k) => k === '_print');
    expect(printEntries).toHaveLength(1);
  });

  it('proves the vite-app override interaction: a user _motionReduce with the built-in value carries ONE entry at the built-in order', () => {
    // Mirrors e2e/vite-app/src/ds.ts, which registers
    // `_motionReduce: '@media (prefers-reduced-motion: reduce)'` — the SAME
    // value the built-in already ships. mergeConditions' override branch keeps
    // the built-in order (300) and replaces the value (a no-op here since the
    // values match). The serialized manifest must therefore carry EXACTLY ONE
    // `_motionReduce` entry, at order 300 — no double-emit, no reorder.
    const { system } = createSystem()
      .addConditions({
        _motionReduce: '@media (prefers-reduced-motion: reduce)',
      })
      .build();
    const conditions = JSON.parse(system.toConfig().conditionAliases) as Record<
      string,
      { value: string; order: number; kind: string }
    >;
    expect(conditions._motionReduce).toEqual({
      value: '@media (prefers-reduced-motion: reduce)',
      order: 300,
      kind: 'media',
    });
    // still exactly nine entries (the built-in set), NOT ten
    expect(Object.keys(conditions)).toHaveLength(9);
  });

  it('allocates new user condition orders starting at 500, skipping the built-in band, without collision', () => {
    // Regression + ORDER BAND proof (inc-03 full-pass): built-ins occupy
    // 300–380. Each addConditions() call floors allocation at 490, so the FIRST
    // new user alias lands at 500 (NOT max(built-in)=380 + 10 = 390, which would
    // collide with / sit below the built-in band), and chained calls continue
    // upward without restarting at 500.
    const { system } = createSystem()
      .addConditions({ _reducedData: '@media (prefers-reduced-data: reduce)' })
      .addConditions({ _cardSm: '@container card (min-width: 400px)' })
      .addConditions({ _hasGrid: '@supports (display: grid)' })
      .build();
    const conditions = JSON.parse(system.toConfig().conditionAliases) as Record<
      string,
      { order: number }
    >;
    // new user aliases: 500, 510, 520 — above the built-in band's top (380)
    expect(conditions._reducedData.order).toBe(500);
    expect(conditions._cardSm.order).toBe(510);
    expect(conditions._hasGrid.order).toBe(520);
    // built-ins keep their reserved band, all below 500
    expect(conditions._motionReduce.order).toBe(300);
    expect(conditions._osLight.order).toBe(380);
    // every allocated order is distinct
    const orders = Object.values(conditions).map((c) => c.order);
    expect(new Set(orders).size).toBe(orders.length);
  });

  it('throws when a condition alias name clashes with a built-in selector alias', () => {
    // Spec scenario: "Condition alias clashing with a built-in selector alias".
    // `_hover` is a built-in SELECTOR alias — registering it as a condition
    // must fail loud at construction, naming the alias and both registries.
    expect(() =>
      createSystem().addConditions({ _hover: '@media print' })
    ).toThrow(/_hover.*selector alias registry/);
  });

  it('throws when a condition alias name clashes with a custom selector alias', () => {
    expect(() =>
      createSystem()
        .addSelectors({ _brand: '&[data-brand]' })
        .addConditions({ _brand: '@container (min-width: 400px)' })
    ).toThrow(/_brand.*selector alias registry/);
  });

  it('throws in the REVERSE order too — selector registered after the condition (F-1.4)', () => {
    expect(() =>
      createSystem()
        .addConditions({ _open: '@media (min-width: 1px)' })
        .addSelectors({ _open: '&[data-open]' })
    ).toThrow(/_open.*condition alias/);
  });
});
