import { describe, expect, it } from 'vitest';

import {
  createSystem,
  createTransform,
  SystemBuilder,
  type AtRuleValue,
  type ConditionAliasMap,
  type Prop,
} from '../src';

interface SerializedMarginProp {
  negative: boolean;
  property: string;
  scale: string;
  transform: string;
}

interface SerializedSizeProp {
  currentVar: string;
  properties: string[];
  property: string;
  scale: { sm: string; lg: string };
}

interface SerializedRatioProp {
  property: string;
}

interface FeaturePropConfig {
  m: SerializedMarginProp;
  ratio: SerializedRatioProp;
  size: SerializedSizeProp;
}

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

type JsonObject = { [key: string]: JsonValue };

interface ConditionAliasCandidate {
  value?: JsonValue;
  order?: JsonValue;
  kind?: JsonValue;
}

type ConditionAliasMapCandidate = Record<string, ConditionAliasCandidate>;
type SerializedSelectorAliases = Record<string, string>;
type RuntimeConditionAliases = Record<`_${string}`, AtRuleValue>;
type RuntimeSelectorAliases = Record<`_${string}`, string>;

interface RuntimeRegistryBuilder {
  addConditions(conditions: RuntimeConditionAliases): RuntimeRegistryBuilder;
  addSelectors(selectors: RuntimeSelectorAliases): RuntimeRegistryBuilder;
}

const propFixture = <Definition extends Prop>(definition: Definition) =>
  definition;

function isJsonObject(value: JsonValue): value is JsonObject {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function isJsonString(value: JsonValue): value is string {
  return Object.prototype.toString.call(value) === '[object String]';
}

function isJsonBoolean(value: JsonValue): value is boolean {
  return Object.prototype.toString.call(value) === '[object Boolean]';
}

function parseFeaturePropConfig(serialized: string): FeaturePropConfig {
  const candidate: JsonValue = JSON.parse(serialized);
  if (
    !isJsonObject(candidate) ||
    !isJsonObject(candidate.m) ||
    !isJsonBoolean(candidate.m.negative) ||
    !isJsonString(candidate.m.property) ||
    !isJsonString(candidate.m.scale) ||
    !isJsonString(candidate.m.transform) ||
    !isJsonObject(candidate.ratio) ||
    !isJsonString(candidate.ratio.property) ||
    !isJsonObject(candidate.size) ||
    !isJsonString(candidate.size.currentVar) ||
    !Array.isArray(candidate.size.properties) ||
    !candidate.size.properties.every(isJsonString) ||
    !isJsonString(candidate.size.property) ||
    !isJsonObject(candidate.size.scale) ||
    !isJsonString(candidate.size.scale.sm) ||
    !isJsonString(candidate.size.scale.lg)
  ) {
    throw new TypeError(
      'propConfig does not match the feature-system contract'
    );
  }
  // SAFETY: every field read below is validated above; the original object is
  // returned so extra-field assertions still see unexpected keys.
  return candidate as JsonObject & FeaturePropConfig;
}

function parseSelectorAliases(serialized: string): SerializedSelectorAliases {
  const candidate: SerializedSelectorAliases = JSON.parse(serialized);
  if (
    Object.prototype.toString.call(candidate) !== '[object Object]' ||
    Object.values(candidate).some(
      (selector) =>
        Object.prototype.toString.call(selector) !== '[object String]'
    )
  ) {
    throw new TypeError('selectorAliases must map aliases to strings');
  }
  return candidate;
}

function parseConditionAliases(serialized: string): ConditionAliasMap {
  const candidates: ConditionAliasMapCandidate = JSON.parse(serialized);
  if (Object.prototype.toString.call(candidates) !== '[object Object]') {
    throw new TypeError('conditionAliases must be an object');
  }

  for (const [alias, candidate] of Object.entries(candidates)) {
    if (
      Object.prototype.toString.call(candidate) !== '[object Object]' ||
      Object.prototype.toString.call(candidate.value) !== '[object String]' ||
      !Number.isFinite(candidate.order)
    ) {
      throw new TypeError(`conditionAliases.${alias} is malformed`);
    }

    switch (candidate.kind) {
      case 'media':
      case 'container':
      case 'supports':
        break;
      default:
        throw new TypeError(`conditionAliases.${alias}.kind is invalid`);
    }
  }
  // SAFETY: the per-entry value, order, and kind checks above cover the
  // ConditionAliasMap contract; entries keep extra fields for exact assertions.
  return candidates as ConditionAliasMap;
}

function registryRuntimeBoundary<Builder>(
  builder: Builder
): RuntimeRegistryBuilder {
  if (!(builder instanceof SystemBuilder)) {
    throw new TypeError('runtime registry boundary requires a SystemBuilder');
  }
  // SAFETY: the instance check establishes both methods; the cast erases their
  // compile-time clash guards so the tests can reach the runtime backstops.
  return builder as Builder & RuntimeRegistryBuilder;
}

function isNumericTransformValue(value: string | number): value is number {
  return (
    Number.isFinite(value) ||
    Number.isNaN(value) ||
    value === Number.POSITIVE_INFINITY ||
    value === Number.NEGATIVE_INFINITY
  );
}

// The Rust extractor deserializes this shape by field name, so a rename,
// removal, or addition only holds when both languages change together.

// An independent copy of the built-in selector map: importing the source
// constant instead would make the golden assertions below vacuous.
const BUILT_IN_SELECTOR_ALIASES = {
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

// An independent copy of the built-in condition map: importing the source
// constant instead would make the golden assertions below vacuous.
const BUILT_IN_CONDITION_ALIASES = {
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
} satisfies ConditionAliasMap;

function buildFeatureSystem() {
  const px = createTransform('px', (value) =>
    isNumericTransformValue(value) ? `${value}px` : value
  );

  const { system } = createSystem()
    .addGroup('layout', {
      m: propFixture({
        property: 'margin',
        scale: 'space',
        transform: px,
        negative: true,
        strict: false,
        variable: '--m',
      }),
      size: propFixture({
        property: 'width',
        properties: ['width', 'height'],
        scale: { sm: '4px', lg: '8px' },
        currentVar: '--size',
      }),
    })
    .addProps({
      ratio: propFixture({ property: 'aspectRatio' }),
    })
    .addSelectors({ _brand: '&[data-brand]' })
    .build();

  return system.toConfig();
}

describe('serializeInstance contract', () => {
  it('emits exactly six top-level keys', () => {
    const config = buildFeatureSystem();

    expect(Object.keys(config).sort()).toEqual([
      'conditionAliases',
      'groupRegistry',
      'propConfig',
      'selectorAliases',
      'transformSources',
      'transforms',
    ]);
  });

  it('pins the exact serialized form of every propConfig entry', () => {
    const propConfig = parseFeaturePropConfig(buildFeatureSystem().propConfig);

    expect(propConfig).toEqual({
      m: {
        negative: true,
        property: 'margin',
        scale: 'space',
        transform: 'px',
      },
      size: {
        currentVar: '--size',
        properties: ['width', 'height'],
        property: 'width',
        scale: { sm: '4px', lg: '8px' },
      },
      ratio: { property: 'aspectRatio' },
    });
  });

  it('maps each group name to its exact ordered prop-name array', () => {
    const config = buildFeatureSystem();

    expect(JSON.parse(config.groupRegistry)).toEqual({
      layout: ['m', 'size'],
    });
  });

  it('registers named transforms as live, callable functions', () => {
    const config = buildFeatureSystem();

    expect(Object.keys(config.transforms)).toEqual(['px']);
    expect(config.transforms.px).toEqual(expect.any(Function));
    expect(config.transforms.px(4)).toBe('4px');
    expect(config.transforms.px('auto')).toBe('auto');
  });

  it('serializes the full built-in selector alias map', () => {
    const config = buildFeatureSystem();
    const selectors = parseSelectorAliases(config.selectorAliases);

    expect(selectors).toEqual({
      ...BUILT_IN_SELECTOR_ALIASES,
      _brand: '&[data-brand]',
    });
  });

  it('matches the complete golden serialized output for a minimal two-prop system', () => {
    const { system } = createSystem()
      .addGroup('space', {
        m: propFixture({ property: 'margin', scale: 'space' }),
        p: propFixture({ property: 'padding', scale: 'space' }),
      })
      .build();

    const config = system.toConfig();

    const normalized = {
      propConfig: JSON.parse(config.propConfig),
      groupRegistry: JSON.parse(config.groupRegistry),
      transforms: config.transforms,
      selectorAliases: JSON.parse(config.selectorAliases),
      conditionAliases: JSON.parse(config.conditionAliases),
    };

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
    const { system: bare } = createSystem()
      .addSelectors({ _brand: '&[data-brand]' })
      .build();
    const bareConfig = bare.toConfig();
    expect(JSON.parse(bareConfig.conditionAliases)).toEqual(
      BUILT_IN_CONDITION_ALIASES
    );

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
      ...BUILT_IN_CONDITION_ALIASES,
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

    expect(condConfig.selectorAliases).toBe(bareConfig.selectorAliases);
  });

  it('serializes exactly the built-in condition set for a system that registers no conditions', () => {
    const { system } = createSystem()
      .addGroup('space', {
        m: propFixture({ property: 'margin', scale: 'space' }),
      })
      .build();
    const config = system.toConfig();
    expect(JSON.parse(config.conditionAliases)).toEqual(
      BUILT_IN_CONDITION_ALIASES
    );
    expect(JSON.parse(config.selectorAliases)).toEqual(
      BUILT_IN_SELECTOR_ALIASES
    );
  });

  it('lets a user condition alias override a built-in of the same name, preserving the built-in order', () => {
    const { system } = createSystem()
      .addConditions({ _print: '@media print and (min-resolution: 300dpi)' })
      .build();
    const conditions = parseConditionAliases(
      system.toConfig().conditionAliases
    );
    expect(conditions._print.value).toBe(
      '@media print and (min-resolution: 300dpi)'
    );
    expect(conditions._print.order).toBe(320);
    const printEntries = Object.keys(conditions).filter((k) => k === '_print');
    expect(printEntries).toHaveLength(1);
  });

  it('proves the vite-app override interaction: a user _motionReduce with the built-in value carries ONE entry at the built-in order', () => {
    const { system } = createSystem()
      .addConditions({
        _motionReduce: '@media (prefers-reduced-motion: reduce)',
      })
      .build();
    const conditions = parseConditionAliases(
      system.toConfig().conditionAliases
    );
    expect(conditions._motionReduce).toEqual({
      value: '@media (prefers-reduced-motion: reduce)',
      order: 300,
      kind: 'media',
    });
    expect(Object.keys(conditions)).toHaveLength(9);
  });

  it('allocates new user condition orders starting at 500, skipping the built-in band, without collision', () => {
    const { system } = createSystem()
      .addConditions({ _reducedData: '@media (prefers-reduced-data: reduce)' })
      .addConditions({ _cardSm: '@container card (min-width: 400px)' })
      .addConditions({ _hasGrid: '@supports (display: grid)' })
      .build();
    const conditions = parseConditionAliases(
      system.toConfig().conditionAliases
    );
    expect(conditions._reducedData.order).toBe(500);
    expect(conditions._cardSm.order).toBe(510);
    expect(conditions._hasGrid.order).toBe(520);
    expect(conditions._motionReduce.order).toBe(300);
    expect(conditions._osLight.order).toBe(380);
    const orders = Object.values(conditions).map((c) => c.order);
    expect(new Set(orders).size).toBe(orders.length);
  });

  it('throws when a condition alias name clashes with a built-in selector alias', () => {
    expect(() =>
      registryRuntimeBoundary(createSystem()).addConditions({
        _hover: '@media print',
      })
    ).toThrow(/_hover.*selector alias registry/);
  });

  it('throws when a condition alias name clashes with a custom selector alias', () => {
    expect(() => {
      const builder = createSystem().addSelectors({
        _brand: '&[data-brand]',
      });
      registryRuntimeBoundary(builder).addConditions({
        _brand: '@container (min-width: 400px)',
      });
    }).toThrow(/_brand.*selector alias registry/);
  });

  it('throws in the REVERSE order too — selector registered after the condition (F-1.4)', () => {
    expect(() => {
      const builder = createSystem().addConditions({
        _open: '@media (min-width: 1px)',
      });
      registryRuntimeBoundary(builder).addSelectors({
        _open: '&[data-open]',
      });
    }).toThrow(/_open.*condition alias/);
  });
});
