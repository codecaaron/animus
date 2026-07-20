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
  it('emits exactly four top-level keys', () => {
    const config = buildFeatureSystem();

    // ASSERTION 1: the exact top-level key set of SerializedConfig.
    expect(Object.keys(config).sort()).toEqual([
      'groupRegistry',
      'propConfig',
      'selectorAliases',
      'transforms',
    ]);

    // Carrier types: three are JSON *strings*, transforms is a live JS object.
    expect(typeof config.propConfig).toBe('string');
    expect(typeof config.groupRegistry).toBe('string');
    expect(typeof config.selectorAliases).toBe('string');
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

    // Normalize the wire form: parse the three JSON-string fields, keep the
    // live `transforms` object as-is (it is `{}` for a transform-free system).
    const normalized = {
      propConfig: JSON.parse(config.propConfig),
      groupRegistry: JSON.parse(config.groupRegistry),
      transforms: config.transforms,
      selectorAliases: JSON.parse(config.selectorAliases),
    };

    // ASSERTION 4: one full deep-equal against the golden literal.
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
    });
  });
});
