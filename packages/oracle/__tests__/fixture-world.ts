import { asRuleId } from '../src/core/identity';
import { eq, range, TRUE } from '../src/core/predicate';
import { createInMemoryHost } from '../src/providers/in-memory';

import type { ScenarioDomain, ScenarioPoint } from '../src/core/scenario';
import type { HostObligation, OracleHost } from '../src/providers/host';
import type { ComponentRecord } from '../src/providers/identity';
import type { InMemoryHostConfig } from '../src/providers/in-memory';
import type {
  TokenDefinition,
  TokenProvider,
  TokenResolution,
} from '../src/providers/tokens';

/**
 * The fixture world the engine suites assert against: two components, one
 * token graph, one rule set, one scenario domain, and the obligations the
 * host declares over them. This is the shared semantic ground — a change to
 * engine behaviour has to be reflected here once instead of in four
 * separately-drifting copies (it was byte-identical in
 * `engine-{cascade,inspect-explain,prove-refine,simulate-diff}.test.ts`).
 *
 * Suites whose world genuinely differs keep only that difference local and
 * say why: `engine-prove-refine` adds two rules its harvest must discover,
 * and `engine-cascade` builds a host WITHOUT the declared obligations
 * because it drives its own `ObligationRegistry`.
 */

export const card: ComponentRecord = {
  id: 'src/Card.tsx::Card',
  file: 'src/Card.tsx',
  binding: 'Card',
  className: 'anm-Card',
  terminal: 'asElement',
  tag: 'div',
};

export const panel: ComponentRecord = {
  id: 'src/Panel.tsx::Panel',
  file: 'src/Panel.tsx',
  binding: 'Panel',
  className: 'anm-Panel',
  terminal: 'asElement',
};

const SCOPED = /^(variant|state):([^:]+):(.+)$/;

/** Component class + the shared `anm-surface` utility + variant/state. */
export const classesFor = (
  component: ComponentRecord,
  point: ScenarioPoint
): readonly string[] => {
  const classes = [component.className, 'anm-surface'];
  for (const dim of Object.keys(point).sort()) {
    const match = SCOPED.exec(dim);
    if (match === null) continue;
    const [, kind, owner, name] = match;
    if (owner !== component.binding) continue;
    const value = point[dim];
    if (kind === 'variant') {
      classes.push(`${component.className}--${name}-${String(value)}`);
    } else if (value === true) {
      classes.push(`${component.className}--${name}`);
    }
  }
  return classes;
};

/** Keyed by variable name, which is a lookup domain rather than a fixed set
 *  of fields — a missing variable must answer `undefined`, never a value
 *  inherited from `Object.prototype`. */
const TOKENS = new Map<string, TokenDefinition>([
  [
    '--color-text',
    {
      variable: '--color-text',
      valuesByMode: { light: '#111', dark: '#eee' },
      references: [],
    },
  ],
  [
    '--surface-bg',
    {
      variable: '--surface-bg',
      valuesByMode: { light: 'var(--color-text)', dark: 'var(--color-text)' },
      references: ['--color-text'],
    },
  ],
]);

export const tokens = (): TokenProvider => ({
  modes: () => ['light', 'dark'],
  defaultMode: () => 'light',
  token: (variable) => TOKENS.get(variable),
  all: () => [...TOKENS.values()],
  resolve: (variable, mode): TokenResolution | undefined => {
    const chain: string[] = [];
    let current = variable;
    for (let depth = 0; depth < 8; depth += 1) {
      chain.push(current);
      const definition = TOKENS.get(current);
      if (definition === undefined) return undefined;
      const raw = definition.valuesByMode[mode];
      if (raw === undefined) return undefined;
      const reference = /^var\((--[a-z-]+)\)$/.exec(raw.trim());
      if (reference === null) return { value: raw, chain };
      current = reference[1];
    }
    return undefined;
  },
});

export interface FixtureOptions {
  pseudoDimension?: boolean;
  important?: boolean;
}

/** The axes every fixture models. `pseudo:hover` is deliberately absent: the
 *  unbound-pseudo-axis case is one of the behaviours under test, so it is
 *  added only when a fixture declares it. */
export const BASE_DIMENSIONS = {
  mode: { kind: 'finite', values: ['light', 'dark'] },
  'viewport.inline': { kind: 'interval', min: 0, max: 1920 },
  'variant:Card:size': { kind: 'finite', values: ['small', 'large'] },
  'state:Card:disabled': { kind: 'finite', values: [false, true] },
} satisfies ScenarioDomain;

export const config = (options: FixtureOptions = {}): InMemoryHostConfig => ({
  rules: [
    {
      id: 'global-body',
      selector: { raw: 'body', classNames: [] },
      declarations: [
        { property: 'color', value: 'var(--color-text)' },
        { property: 'font-size', value: '16px' },
      ],
      condition: TRUE,
      layer: 'anm-global',
      order: 0,
      source: { file: 'src/theme.ts', span: [10, 40] },
    },
    {
      id: 'base-card',
      selector: { raw: '.anm-Card', classNames: ['anm-Card'] },
      declarations: [
        {
          property: 'padding',
          value: '4px',
          authoredProperty: 'p',
          authoredValue: '1',
        },
        { property: 'gap', value: '2px' },
      ],
      condition: TRUE,
      layer: 'anm-base',
      order: 0,
      source: { file: 'src/Card.tsx', span: [67, 200] },
      origin: { component: 'Card', method: 'styles' },
    },
    {
      id: 'surface',
      selector: { raw: '.anm-surface', classNames: ['anm-surface'] },
      declarations: [
        { property: 'background', value: 'var(--surface-bg)' },
        { property: 'gap', value: '5px' },
      ],
      condition: TRUE,
      layer: 'anm-base',
      order: 1,
      source: { file: 'src/theme.ts' },
    },
    {
      id: 'variant-large',
      selector: {
        raw: '.anm-Card--size-large',
        classNames: ['anm-Card--size-large'],
      },
      declarations: [{ property: 'padding', value: '12px' }],
      condition: eq('variant:Card:size', 'large'),
      layer: 'anm-variants',
      order: 2,
      source: { file: 'src/Card.tsx' },
      origin: {
        component: 'Card',
        method: 'variant',
        variantProp: 'size',
        variantOption: 'large',
      },
    },
    {
      id: 'variant-large-strong',
      selector: {
        raw: '.anm-Card.anm-Card--size-large',
        classNames: ['anm-Card', 'anm-Card--size-large'],
      },
      declarations: [{ property: 'padding', value: '20px' }],
      condition: eq('variant:Card:size', 'large'),
      layer: 'anm-variants',
      order: 0,
      source: { file: 'src/Card.tsx' },
      origin: { component: 'Card', method: 'compound', compoundIndex: 0 },
    },
    {
      id: 'wide',
      selector: { raw: '.anm-Card', classNames: ['anm-Card'] },
      declarations: [{ property: 'padding', value: '16px' }],
      condition: range('viewport.inline', { min: 768 }),
      layer: 'anm-variants',
      order: 3,
      source: { file: 'src/Card.tsx' },
    },
    {
      id: 'hover',
      selector: {
        raw: '.anm-Card:hover',
        classNames: ['anm-Card'],
        pseudo: ['hover'],
      },
      declarations: [{ property: 'border-color', value: 'red' }],
      condition: TRUE,
      layer: 'anm-states',
      order: 1,
      source: { file: 'src/Card.tsx' },
    },
    {
      id: 'marker',
      selector: {
        raw: '.anm-Card::before',
        classNames: ['anm-Card'],
        pseudo: ['::before'],
      },
      declarations: [{ property: 'content', value: '""' }],
      condition: TRUE,
      layer: 'anm-custom',
      order: 1,
      source: { file: 'src/Card.tsx' },
    },
    {
      id: 'unresolved',
      selector: { raw: '.anm-Card', classNames: ['anm-Card'] },
      declarations: [{ property: 'outline-color', value: 'var(--missing)' }],
      condition: TRUE,
      layer: 'anm-custom',
      order: 0,
      source: { file: 'src/Card.tsx' },
    },
    ...(options.important === true
      ? [
          {
            id: 'base-important',
            selector: { raw: '.anm-Card', classNames: ['anm-Card'] },
            declarations: [
              { property: 'padding', value: '1px', important: true },
            ],
            condition: TRUE,
            layer: 'anm-base',
            order: 9,
            source: { file: 'src/Card.tsx' },
          },
          {
            id: 'variants-important',
            selector: { raw: '.anm-Card', classNames: ['anm-Card'] },
            declarations: [
              { property: 'padding', value: '2px', important: true },
            ],
            condition: TRUE,
            layer: 'anm-variants',
            order: 9,
            source: { file: 'src/Card.tsx' },
          },
        ]
      : []),
    {
      id: 'panel-base',
      selector: { raw: '.anm-Panel', classNames: ['anm-Panel'] },
      declarations: [{ property: 'padding', value: '3px' }],
      condition: TRUE,
      layer: 'anm-base',
      order: 2,
      source: { file: 'src/Panel.tsx' },
      origin: { component: 'Panel', method: 'styles' },
    },
  ],
  components: [card, panel],
  dimensions:
    options.pseudoDimension === true
      ? {
          ...BASE_DIMENSIONS,
          'pseudo:hover': { kind: 'finite', values: [false, true] },
        }
      : { ...BASE_DIMENSIONS },
  cuts: { 'viewport.inline': [768] },
  namedScenarios: {
    'compact.dark': {
      mode: 'dark',
      'viewport.inline': 375,
      'variant:Card:size': 'small',
      'state:Card:disabled': false,
    },
  },
  classesFor,
  ruleDependencies: { 'base-card': ['src/Card.tsx'] },
});

export const obligations = (): readonly HostObligation[] => [
  {
    origin: { file: 'src/Card.tsx', note: 'gap is filled from a runtime prop' },
    guard: eq('variant:Card:size', 'large'),
    effectClass: 'dynamic-value',
    influenceScope: [
      { kind: 'declaration', rule: asRuleId('base-card'), property: 'gap' },
    ],
    reason:
      'the gap slot is written by a runtime prop the compiler cannot fold',
    dischargeOptions: [
      {
        kind: 'branch-split',
        description: 'evaluate both declared size variants',
        automated: true,
      },
    ],
    dependencies: [],
  },
  {
    origin: { file: 'src/theme.ts', note: ':has() is outside the dialect' },
    guard: TRUE,
    effectClass: 'external-css',
    influenceScope: [
      { kind: 'rule', rule: asRuleId('surface') },
      {
        kind: 'declaration',
        rule: asRuleId('surface'),
        property: 'background',
      },
    ],
    reason:
      'a relational (:has) selector in hand-written CSS can override the ' +
      'surface background',
    dischargeOptions: [
      {
        kind: 'context-capsule-measurement',
        description: 'measure the computed background in a browser capsule',
        automated: false,
      },
      {
        kind: 'manual-declaration',
        description: 'declare the relational rule in the style universe',
        automated: false,
      },
    ],
    dependencies: [],
  },
];

export const host = (options: FixtureOptions = {}): OracleHost => ({
  ...createInMemoryHost(config(options)),
  tokens: tokens(),
  obligations,
});

export const smallNarrow: ScenarioPoint = {
  mode: 'light',
  'viewport.inline': 400,
  'variant:Card:size': 'small',
  'state:Card:disabled': false,
};
