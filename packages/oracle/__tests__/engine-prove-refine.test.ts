import { describe, expect, it } from 'vitest';

import { asRuleId } from '../src/core/identity';
import { eq, range, TRUE } from '../src/core/predicate';
import { applyDeltas } from '../src/core/world';
import { createOracle, DEFAULT_MAX_CELLS } from '../src/engines';
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
      id: 'wide-1024',
      selector: { raw: '.anm-Card', classNames: ['anm-Card'] },
      declarations: [{ property: 'padding', value: '24px' }],
      // 1024 is deliberately NOT in `cuts`: prove has to harvest it.
      condition: range('viewport.inline', { min: 1024 }),
      layer: 'anm-system',
      order: 0,
      source: { file: 'src/Card.tsx' },
    },
    {
      id: 'state-disabled',
      selector: {
        raw: '.anm-Card--disabled',
        classNames: ['anm-Card--disabled'],
      },
      declarations: [{ property: 'gap', value: '10px' }],
      condition: eq('state:Card:disabled', true),
      layer: 'anm-states',
      order: 0,
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

const dynamicObligation = (oracle: ReturnType<typeof createOracle>) => {
  const found = oracle
    .obligations()
    .find((obligation) => obligation.effectClass === 'dynamic-value');
  if (found === undefined) throw new Error('fixture: obligation must exist');
  return found;
};

const relationalObligation = (oracle: ReturnType<typeof createOracle>) => {
  const found = oracle
    .obligations()
    .find((obligation) => obligation.effectClass === 'external-css');
  if (found === undefined) throw new Error('fixture: obligation must exist');
  return found;
};

describe('prove — PROVED', () => {
  const result = createOracle(host()).prove({
    assertions: [
      {
        kind: 'effective-value-in',
        target: 'Card',
        property: 'padding',
        allowed: ['4px', '16px', '20px', '24px'],
      },
    ],
  });

  it('quantifies over every cell, harvesting rule-guard thresholds', () => {
    expect(result.verdict).toBe('PROVED');
    expect(result.summary).toContain(
      'cuts harvested from rule guards: viewport.inline = 1024'
    );
    // Vacuity guard: 1024 really did split the partition. Without it the
    // domain is 2 modes × 3 viewport cells × 2 sizes × 2 states = 24.
    expect(result.coverage.cellsEvaluated).toBe(40);
    expect(result.coverage.scenarioCells).toBe(40);
  });

  it('scopes the claim to the world it was proved in', () => {
    expect(result.summary).toContain(
      'PROVED under this program revision, scenario domain, environment ' +
        'profile and model version — not beyond them.'
    );
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]).toMatchObject({
      property: 'assertion:effective-value-in:padding',
      value: { kind: 'exact', value: 'holds' },
      guard: { kind: 'true' },
      authority: { kind: 'static-proof' },
    });
  });

  it('proves a token origin and the absence of !important', () => {
    const proved = createOracle(host()).prove({
      assertions: [
        {
          kind: 'winner-origin-token',
          target: 'Card',
          property: 'color',
          token: '--color-text',
        },
        { kind: 'no-important', target: 'Card' },
      ],
    });

    expect(proved.verdict).toBe('PROVED');
    expect(proved.facts.map((fact) => fact.property).sort()).toEqual([
      'assertion:no-important',
      'assertion:winner-origin-token:color',
    ]);
  });
});

describe('prove — DISPROVED', () => {
  const result = createOracle(host()).prove({
    assertions: [
      {
        kind: 'effective-value',
        target: 'Card',
        property: 'padding',
        expected: '4px',
      },
    ],
  });

  it('minimizes the counterexample and names the boundary it sits on', () => {
    expect(result.verdict).toBe('DISPROVED');
    expect(result.witnesses).toHaveLength(1);
    expect(result.witnesses?.[0].point).toEqual({
      mode: 'light',
      'state:Card:disabled': false,
      'variant:Card:size': 'small',
      'viewport.inline': 768,
    });
    expect(result.witnesses?.[0].violation).toContain(
      "padding = '16px' (expected '4px') from wide"
    );
    expect(result.witnesses?.[0].boundary).toBe(
      'passes for viewport.inline < 768'
    );
  });

  it('counts the failing cells and proposes the next probe', () => {
    // Vacuity guard: a single-cell "proof" would prove nothing.
    expect(result.coverage.cellsEvaluated).toBeGreaterThan(1);
    expect(result.summary).toMatch(/DISPROVED: \d+ cells violate/);
    expect(result.summary).toContain(
      'assertion:effective-value:padding fails in'
    );
    expect(result.nextOperations.map((operation) => operation.kind)).toContain(
      'explain'
    );
  });

  it('records the violated assertion as a guarded fact', () => {
    expect(result.facts[0]).toMatchObject({
      property: 'assertion:effective-value:padding',
      value: { kind: 'exact', value: 'violated' },
    });
    expect(result.facts[0].guard.kind).toBe('and');
  });

  it('disproves mode-invariance for a mode-varying token', () => {
    const invariance = createOracle(host()).prove({
      assertions: [
        { kind: 'mode-invariant', target: 'Card', property: 'color' },
      ],
    });

    expect(invariance.verdict).toBe('DISPROVED');
    expect(invariance.witnesses?.[0].violation).toContain(
      "color = '#eee' under mode = dark but '#111' under mode = light"
    );
  });
});

describe('prove — CONDITIONAL and INCONCLUSIVE', () => {
  it('never reports PROVED while an obligation touches the property', () => {
    const result = createOracle(host()).prove({
      assertions: [
        {
          kind: 'effective-value-in',
          target: 'Card',
          property: 'gap',
          allowed: ['5px', '10px'],
        },
      ],
    });

    expect(result.verdict).toBe('CONDITIONAL');
    expect(result.summary).toContain(
      'The assertions hold in every evaluated cell, but unresolved ' +
        'obligations touch them'
    );
    expect(
      result.unknowns.map((unknown) => unknown.effectClass).sort()
    ).toEqual(['dynamic-value', 'external-css']);
    expect(result.summary).toContain('CONDITIONAL, not PROVED.');
  });

  it('refuses to answer past the cell budget', () => {
    const result = createOracle(host()).prove({
      budget: { maxCells: 4 },
      assertions: [
        {
          kind: 'effective-value',
          target: 'Card',
          property: 'padding',
          expected: '4px',
        },
      ],
    });

    expect(result.verdict).toBe('INCONCLUSIVE');
    expect(result.coverage.cellsEvaluated).toBe(0);
    expect(result.summary).toContain('spans 24 cells, over the budget of 4');
    expect(result.nextOperations.map((operation) => operation.kind)).toContain(
      'narrow-domain'
    );
  });

  it('uses a default budget large enough for this domain', () => {
    expect(DEFAULT_MAX_CELLS).toBe(512);
    const result = createOracle(host()).prove({
      assertions: [{ kind: 'no-important', target: 'Card' }],
    });
    expect(result.verdict).toBe('PROVED');
    expect(result.coverage.cellsEvaluated).toBe(40);
  });

  it('validates the assertion shape', () => {
    const oracle = createOracle(host());
    expect(() =>
      oracle.prove({
        assertions: [{ kind: 'looks-nice', target: 'Card' } as never],
      })
    ).toThrow(/unknown assertion kind 'looks-nice'/);
    expect(() =>
      oracle.prove({
        assertions: [{ kind: 'effective-value', target: 'Card' } as never],
      })
    ).toThrow(/requires a property name/);
    expect(() => oracle.prove({ assertions: [] })).toThrow(
      /at least one assertion is required/
    );
  });
});

describe('prove — fixpoint', () => {
  it('answers FIXPOINT on an unchanged repeat, with the prior state', () => {
    const oracle = createOracle(host());
    const request = {
      assertions: [
        {
          kind: 'effective-value' as const,
          target: 'Card',
          property: 'padding',
          expected: '4px',
        },
      ],
    };

    const first = oracle.prove(request);
    const second = oracle.prove(request);

    expect(first.verdict).toBe('DISPROVED');
    expect(second.verdict).toBe('FIXPOINT');
    expect(second.previous).toBe(first.probeStateId);
    expect(second.probeStateId).toBe(first.probeStateId);
    expect(second.knowledgeDelta).toEqual({
      newFacts: 0,
      precisionImprovements: 0,
      candidatesEliminated: 0,
      newObligations: 0,
    });
    expect(second.nextOperations).toEqual(first.nextOperations);
    expect(second.summary).toContain('FIXPOINT: no new information');

    // Vacuity guard: the first probe really did learn something.
    expect(first.knowledgeDelta.newFacts).toBeGreaterThan(0);
  });

  it('is not a fixpoint when only the domain override differs', () => {
    const oracle = createOracle(host());
    const assertions = [
      {
        kind: 'mode-invariant' as const,
        target: 'Card',
        property: 'padding',
      },
    ];

    const narrow = oracle.prove({
      assertions,
      domain: { mode: { kind: 'finite', values: ['dark'] } },
    });
    const wide = oracle.prove({
      assertions,
      domain: { mode: { kind: 'finite', values: ['dark', 'light'] } },
    });
    const repeat = oracle.prove({
      assertions,
      domain: { mode: { kind: 'finite', values: ['dark', 'light'] } },
    });

    // The override is world identity: a different quantified domain must
    // never collide in the ledger and inherit the other domain's answer.
    expect(narrow.verdict).not.toBe('FIXPOINT');
    expect(wide.verdict).not.toBe('FIXPOINT');
    expect(wide.probeStateId).not.toBe(narrow.probeStateId);
    expect(repeat.verdict).toBe('FIXPOINT');
    expect(repeat.previous).toBe(wide.probeStateId);

    // Vacuity guard: the two domains genuinely quantified differently.
    expect(wide.coverage.scenarioCells).toBeGreaterThan(
      narrow.coverage.scenarioCells
    );
    // The pin is visible in the world, not smuggled around it.
    expect(wide.worldId === narrow.worldId ? 'collided' : 'distinct').toBe(
      'distinct'
    );
  });

  it('is not a fixpoint once the world changes', () => {
    const oracle = createOracle(host());
    const assertions = [
      {
        kind: 'effective-value' as const,
        target: 'Card',
        property: 'padding',
        expected: '4px',
      },
    ];

    const first = oracle.prove({ assertions });
    const moved = oracle.prove({
      assertions,
      world: applyDeltas(oracle.baselineWorld(), [
        {
          kind: 'replace-declaration',
          rule: asRuleId('wide'),
          property: 'padding',
          value: '4px',
        },
      ]),
    });

    expect(moved.verdict).not.toBe('FIXPOINT');
    expect(moved.probeStateId).not.toBe(first.probeStateId);
    expect(moved.worldId).not.toBe(first.worldId);
  });

  it('separates inspect from explain at the same point', () => {
    const oracle = createOracle(host());
    const inspected = oracle.inspect({ target: 'Card', at: smallNarrow });
    const explained = oracle.explain({
      target: 'Card',
      at: smallNarrow,
      symptom: { kind: 'unexpected-value', detail: { property: 'padding' } },
    });

    expect(explained.verdict).not.toBe('FIXPOINT');
    expect(explained.probeStateId).not.toBe(inspected.probeStateId);
    expect(oracle.inspect({ target: 'Card', at: smallNarrow }).verdict).toBe(
      'FIXPOINT'
    );
  });
});

describe('refine', () => {
  it('executes a branch split over a finite unbound axis', () => {
    const oracle = createOracle(host());
    const result = oracle.refine({
      obligation: dynamicObligation(oracle).id,
    });

    expect(result.verdict).toBe('ESTABLISHED');
    expect(result.summary).toContain(
      'by branch split on variant:Card:size ∈ {small, large}'
    );
    expect(result.knowledgeDelta.newFacts).toBeGreaterThan(0);
    expect(result.coverage.cellsEvaluated).toBe(2);

    const guards = result.facts
      .filter((fact) => fact.property === 'padding')
      .map((fact) => JSON.stringify(fact.guard));
    expect(guards.length).toBe(2);
    expect(guards.some((guard) => guard.includes('"value":"small"'))).toBe(
      true
    );
    expect(guards.some((guard) => guard.includes('"value":"large"'))).toBe(
      true
    );
  });

  it('stays CONDITIONAL when no sound automated procedure exists', () => {
    const oracle = createOracle(host());
    const result = oracle.refine({
      obligation: relationalObligation(oracle).id,
    });

    expect(result.verdict).toBe('CONDITIONAL');
    expect(result.summary).toContain(
      "the cheapest sound procedure is 'manual-declaration'"
    );
    expect(result.unknowns).toHaveLength(1);
    expect(result.nextOperations.map((operation) => operation.kind)).toEqual([
      'discharge:manual-declaration',
      'discharge:context-capsule-measurement',
    ]);
  });

  it('honours a policy that refuses the fork', () => {
    const oracle = createOracle(host());
    const result = oracle.refine({
      obligation: dynamicObligation(oracle).id,
      policy: { allowBranchSplit: false },
    });

    expect(result.verdict).toBe('CONDITIONAL');
    expect(result.summary).toContain('remains open');
  });

  it('refuses an unknown obligation id', () => {
    expect(() =>
      createOracle(host()).refine({ obligation: 'not-an-obligation' })
    ).toThrow(/unknown obligation 'not-an-obligation'/);
  });
});
