import { describe, expect, it } from 'vitest';

import { asRuleId } from '../src/core/identity';
import { eq, range, TRUE } from '../src/core/predicate';
import { applyDeltas } from '../src/core/world';
import { createOracle } from '../src/engines';
import { createInMemoryHost } from '../src/providers/in-memory';

import type { ScenarioPoint } from '../src/core/scenario';
import type { HostObligation, OracleHost } from '../src/providers/host';
import type { ComponentRecord } from '../src/providers/identity';
import type { InMemoryHostConfig } from '../src/providers/in-memory';
import type {
  TokenDefinition,
  TokenProvider,
  TokenResolution,
} from '../src/providers/tokens';

const card: ComponentRecord = {
  id: 'src/Card.tsx::Card',
  file: 'src/Card.tsx',
  binding: 'Card',
  className: 'anm-Card',
  terminal: 'asElement',
  tag: 'div',
};

const panel: ComponentRecord = {
  id: 'src/Panel.tsx::Panel',
  file: 'src/Panel.tsx',
  binding: 'Panel',
  className: 'anm-Panel',
  terminal: 'asElement',
};

const SCOPED = /^(variant|state):([^:]+):(.+)$/;

/** Component class + the shared `anm-surface` utility + variant/state. */
const classesFor = (
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

const TOKENS: Readonly<Record<string, TokenDefinition>> = {
  '--color-text': {
    variable: '--color-text',
    valuesByMode: { light: '#111', dark: '#eee' },
    references: [],
  },
  '--surface-bg': {
    variable: '--surface-bg',
    valuesByMode: { light: 'var(--color-text)', dark: 'var(--color-text)' },
    references: ['--color-text'],
  },
};

const tokens = (): TokenProvider => ({
  modes: () => ['light', 'dark'],
  defaultMode: () => 'light',
  token: (variable) => TOKENS[variable],
  all: () => Object.values(TOKENS),
  resolve: (variable, mode): TokenResolution | undefined => {
    const chain: string[] = [];
    let current = variable;
    for (let depth = 0; depth < 8; depth += 1) {
      chain.push(current);
      const definition = TOKENS[current];
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

interface FixtureOptions {
  pseudoDimension?: boolean;
  important?: boolean;
}

const config = (options: FixtureOptions = {}): InMemoryHostConfig => ({
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
  dimensions: {
    mode: { kind: 'finite', values: ['light', 'dark'] },
    'viewport.inline': { kind: 'interval', min: 0, max: 1920 },
    'variant:Card:size': { kind: 'finite', values: ['small', 'large'] },
    'state:Card:disabled': { kind: 'finite', values: [false, true] },
    ...(options.pseudoDimension === true
      ? { 'pseudo:hover': { kind: 'finite' as const, values: [false, true] } }
      : {}),
  },
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

const obligations = (): readonly HostObligation[] => [
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

const host = (options: FixtureOptions = {}): OracleHost => ({
  ...createInMemoryHost(config(options)),
  tokens: tokens(),
  obligations,
});

const smallNarrow: ScenarioPoint = {
  mode: 'light',
  'viewport.inline': 400,
  'variant:Card:size': 'small',
  'state:Card:disabled': false,
};

const large: ScenarioPoint = {
  ...smallNarrow,
  'variant:Card:size': 'large',
};

const contextsOf = (entries: readonly { context: string }[]): string[] =>
  Array.from(new Set(entries.map((entry) => entry.context.split(' @ ')[0])));

describe('simulate — focal effect', () => {
  it('flips the winner when the winning declaration is removed', () => {
    const result = createOracle(host()).simulate({
      target: 'Card',
      at: large,
      deltas: [
        {
          kind: 'remove-declaration',
          rule: asRuleId('variant-large-strong'),
          property: 'padding',
        },
      ],
    });
    const diff = result.semanticDiff as { entries: readonly unknown[] };
    const padding = (
      diff.entries as readonly {
        property: string;
        kind: string;
        before?: string;
        after?: string;
      }[]
    ).filter((entry) => entry.property === 'padding');

    expect(result.verdict).toBe('ESTABLISHED');
    expect(padding[0]).toMatchObject({
      kind: 'winner-changed',
      before: '20px',
      after: '12px',
    });
  });

  it('keeps a single-point simulation a witness, not a domain claim', () => {
    const result = createOracle(host()).simulate({
      target: 'Card',
      at: large,
      deltas: [
        {
          kind: 'remove-declaration',
          rule: asRuleId('variant-large-strong'),
          property: 'padding',
        },
      ],
    });

    expect(result.causalFindings?.[0].status).toBe(
      'MODEL_RELATIVE_INTERVENTION_WITNESS'
    );
    expect(result.coverage.cellsEvaluated).toBeGreaterThan(1);
  });

  it('claims sufficiency only when every focal cell moved', () => {
    const result = createOracle(host()).simulate({
      target: 'Card',
      deltas: [
        {
          kind: 'remove-declaration',
          rule: asRuleId('surface'),
          property: 'background',
        },
      ],
    });

    expect(result.causalFindings?.[0]).toMatchObject({
      status: 'SUFFICIENT_UNDER_DOMAIN',
    });
    expect(result.causalFindings?.[0].note).toContain('background');
    expect(result.coverage.cellsEvaluated).toBeGreaterThan(1);
  });

  it('refuses a delta that names nothing in the universe', () => {
    const oracle = createOracle(host());
    expect(() =>
      oracle.simulate({
        deltas: [
          {
            kind: 'remove-declaration',
            rule: asRuleId('nope'),
            property: 'padding',
          },
        ],
      })
    ).toThrow(/no rule 'nope' in the modeled universe/);
    expect(() =>
      oracle.simulate({
        deltas: [
          {
            kind: 'replace-declaration',
            rule: asRuleId('base-card'),
            property: 'margin',
            value: '0',
          },
        ],
      })
    ).toThrow(/rule 'base-card' declares no 'margin'/);
  });
});

describe('simulate — collateral sweep', () => {
  const result = createOracle(host()).simulate({
    target: 'Card',
    deltas: [
      {
        kind: 'remove-declaration',
        rule: asRuleId('surface'),
        property: 'background',
      },
    ],
  });
  const entries = (
    result.semanticDiff as {
      entries: readonly {
        context: string;
        property: string;
        kind: string;
      }[];
    }
  ).entries;

  it('catches the second component that shares the rule', () => {
    const components = contextsOf(entries);
    // Vacuity guard: the sweep must have reached more than the focal target.
    expect(components.length).toBeGreaterThan(1);
    expect(components.sort()).toEqual(['Card', 'Panel']);
  });

  it('classifies the removal as a removed declaration', () => {
    expect(
      entries.filter((entry) => entry.property === 'background')[0].kind
    ).toBe('declaration-removed');
  });
});

describe('simulate — force-dimension', () => {
  const deltas = [
    {
      kind: 'force-dimension' as const,
      dimension: 'variant:Card:size',
      value: 'large',
    },
  ];

  it('narrows the scenario domain of the hypothetical world', () => {
    const oracle = createOracle(host());
    const forced = applyDeltas(oracle.baselineWorld(), deltas);

    expect(forced.scenario['variant:Card:size']).toEqual({
      kind: 'finite',
      values: ['large'],
    });
    expect(forced.interventions).toEqual(deltas);
  });

  it('reports the rules the forced binding activates', () => {
    const result = createOracle(host()).simulate({ target: 'Card', deltas });
    const entries = (
      result.semanticDiff as {
        entries: readonly {
          property: string;
          kind: string;
          before?: string;
          after?: string;
          context: string;
        }[];
      }
    ).entries;
    const activated = entries.filter(
      (entry) => entry.property === 'padding' && entry.kind === 'rule-activated'
    );

    expect(activated.length).toBeGreaterThan(0);
    expect(activated[0].after).toBe('20px');
    expect(activated[0].context).toContain('variant:Card:size = small');
  });

  it('is not a fixpoint when only the domain override differs', () => {
    const oracle = createOracle(host());
    const request = {
      target: 'Card',
      deltas: [
        {
          kind: 'remove-declaration' as const,
          rule: asRuleId('base-card'),
          property: 'padding',
        },
      ],
    };

    const narrow = oracle.simulate({
      ...request,
      domain: {
        'variant:Card:size': { kind: 'finite', values: ['small'] },
      },
    });
    const wide = oracle.simulate({
      ...request,
      domain: {
        'variant:Card:size': { kind: 'finite', values: ['small', 'large'] },
      },
    });

    // A domain override is world identity — different quantifications must
    // not collide in the probe ledger (same hazard as prove's override).
    expect(narrow.verdict).not.toBe('FIXPOINT');
    expect(wide.verdict).not.toBe('FIXPOINT');
    expect(wide.probeStateId).not.toBe(narrow.probeStateId);

    // Vacuity guard: the domains genuinely differ in size.
    expect(wide.coverage.scenarioCells).toBeGreaterThan(
      narrow.coverage.scenarioCells
    );
  });
});

describe('diff — classification and context classes', () => {
  it('separates value-changed from token-changed', () => {
    const result = createOracle(host()).diff({
      target: 'Card',
      candidate: {
        deltas: [
          {
            kind: 'replace-declaration',
            rule: asRuleId('base-card'),
            property: 'padding',
            value: '5px',
          },
          { kind: 'replace-token', token: '--color-text', value: '#000' },
        ],
      },
    });
    const entries = (
      result.semanticDiff as {
        entries: readonly {
          property: string;
          kind: string;
          before?: string;
          after?: string;
        }[];
      }
    ).entries;
    const of = (property: string, kind: string) =>
      entries.filter(
        (entry) => entry.property === property && entry.kind === kind
      );

    expect(of('padding', 'value-changed')[0]).toMatchObject({
      before: '4px',
      after: '5px',
    });
    // The token moves in every mode, so both mode cells report the change
    // with their own prior value — that is the point of a token diff.
    expect(
      Array.from(
        new Set(
          of('color', 'token-changed').map(
            (entry) => `${entry.before ?? ''} → ${entry.after ?? ''}`
          )
        )
      ).sort()
    ).toEqual(['#111 → #000', '#eee → #000']);
    expect(of('background', 'token-changed').length).toBeGreaterThan(0);
  });

  it('counts affected and unaffected context classes', () => {
    const result = createOracle(host()).diff({
      target: 'Card',
      candidate: {
        deltas: [
          {
            kind: 'replace-declaration',
            rule: asRuleId('variant-large-strong'),
            property: 'padding',
            value: '21px',
          },
        ],
      },
    });
    const diff = result.semanticDiff as {
      entries: readonly unknown[];
      affectedContextClasses: number;
      unaffectedContextClasses: number;
    };
    const classes = createOracle(host()).equivalenceClasses({
      target: 'Card',
    });

    expect(diff.entries.length).toBeGreaterThan(0);
    expect(diff.affectedContextClasses).toBeGreaterThan(0);
    // Vacuity guard: the change must NOT touch every context class.
    expect(diff.unaffectedContextClasses).toBeGreaterThan(0);
    expect(diff.affectedContextClasses + diff.unaffectedContextClasses).toBe(
      classes.classes.length
    );
  });

  it('partitions the domain by the active rule set', () => {
    const classes = createOracle(host()).equivalenceClasses({ target: 'Card' });

    expect(classes.classes.length).toBeGreaterThan(1);
    expect(classes.classes.every((entry) => entry.cellCount >= 1)).toBe(true);
    expect(
      new Set(classes.classes.map((entry) => entry.activeRuleFingerprint)).size
    ).toBe(classes.classes.length);
  });
});

describe('simulate — tokens declared only in :root', () => {
  // The animus provider declares aliases in `:root` and only leaf values per
  // mode; a mode lookup falls back to the root layer. The overlay must walk
  // with the same fallback or a replace-token behind an alias is a no-op.
  const ALIASED: Readonly<Record<string, TokenDefinition>> = {
    '--space-4': {
      variable: '--space-4',
      valuesByMode: { root: '16px' },
      references: [],
    },
    '--space-md': {
      variable: '--space-md',
      valuesByMode: { root: 'var(--space-4)' },
      references: ['--space-4'],
    },
  };

  const aliasTokens = (): TokenProvider => ({
    modes: () => ['light', 'dark'],
    defaultMode: () => 'light',
    token: (variable) => ALIASED[variable],
    all: () => Object.values(ALIASED),
    resolve: (variable, mode): TokenResolution | undefined => {
      const chain: string[] = [];
      let current = variable;
      for (let depth = 0; depth < 8; depth += 1) {
        chain.push(current);
        const definition = ALIASED[current];
        if (definition === undefined) return undefined;
        const raw =
          definition.valuesByMode[mode] ?? definition.valuesByMode['root'];
        if (raw === undefined) return undefined;
        const reference = /^var\((--[a-z0-9-]+)\)$/.exec(raw.trim());
        if (reference === null) return { value: raw, chain };
        current = reference[1];
      }
      return undefined;
    },
  });

  it('sees the change when replacing a token behind a :root alias', () => {
    const base = config();
    const spaced: InMemoryHostConfig = {
      ...base,
      rules: [
        ...base.rules,
        {
          id: 'spaced',
          selector: { raw: '.anm-Card', classNames: ['anm-Card'] },
          declarations: [{ property: 'margin', value: 'var(--space-md)' }],
          condition: TRUE,
          layer: 'anm-custom',
          order: 5,
          source: { file: 'src/Card.tsx' },
        },
      ],
    };
    const result = createOracle({
      ...createInMemoryHost(spaced),
      tokens: aliasTokens(),
    }).simulate({
      target: 'Card',
      deltas: [{ kind: 'replace-token', token: '--space-4', value: '32px' }],
    });

    const entries = (
      result.semanticDiff as {
        entries: readonly {
          property: string;
          before?: string;
          after?: string;
        }[];
      }
    ).entries;
    const margins = entries.filter((entry) => entry.property === 'margin');

    expect(margins.length).toBeGreaterThan(0);
    expect(margins[0]).toMatchObject({ before: '16px', after: '32px' });
  });
});

describe('partial sweeps', () => {
  // A delta that changes nothing observable: replacing a declaration with
  // its own value. Only a complete sweep may say "no change anywhere".
  const noopDeltas = [
    {
      kind: 'replace-declaration' as const,
      rule: asRuleId('base-card'),
      property: 'padding',
      value: '4px',
    },
  ];

  it('simulate refuses a settled answer when the budget truncates the sweep', () => {
    const result = createOracle(host(), { budget: { maxCells: 2 } }).simulate({
      target: 'Card',
      deltas: noopDeltas,
    });

    expect(result.verdict).toBe('INCONCLUSIVE');
    expect(result.summary).not.toContain('anywhere in the modeled universe');
  });

  it('diff refuses a settled answer when the budget truncates the sweep', () => {
    const result = createOracle(host(), { budget: { maxCells: 2 } }).diff({
      target: 'Card',
      candidate: { deltas: noopDeltas },
    });

    expect(result.verdict).toBe('INCONCLUSIVE');
  });
});

describe('probe identity across operations', () => {
  const deltas = [
    {
      kind: 'remove-declaration' as const,
      rule: asRuleId('surface'),
      property: 'background',
    },
  ];

  it('diff asked after simulate of the same deltas is not its fixpoint', () => {
    const oracle = createOracle(host());
    const simulated = oracle.simulate({ target: 'Card', deltas });
    const diffed = oracle.diff({ target: 'Card', candidate: { deltas } });

    expect(simulated.verdict).not.toBe('FIXPOINT');
    expect(diffed.verdict).not.toBe('FIXPOINT');
    // diff makes no causal claims — a collided answer would carry simulate's.
    expect(diffed.causalFindings).toBeUndefined();
  });

  it('simulate asked after diff still delivers its own causal finding', () => {
    const oracle = createOracle(host());
    const diffed = oracle.diff({ target: 'Card', candidate: { deltas } });
    const simulated = oracle.simulate({ target: 'Card', deltas });

    expect(diffed.causalFindings).toBeUndefined();
    expect(simulated.verdict).not.toBe('FIXPOINT');
    expect(simulated.causalFindings?.[0]?.status).toBe(
      'SUFFICIENT_UNDER_DOMAIN'
    );
  });
});
