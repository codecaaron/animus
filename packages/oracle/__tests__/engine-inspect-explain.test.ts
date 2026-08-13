import { describe, expect, it } from 'vitest';

import { asRuleId } from '../src/core/identity';
import { eq, range, TRUE } from '../src/core/predicate';
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

describe('inspect — the envelope', () => {
  const oracle = createOracle(host());
  const result = oracle.inspect({ target: 'Card', at: smallNarrow });

  it('establishes one fact per resolved property, plus inherited ones', () => {
    const byProperty = Object.fromEntries(
      result.facts.map((fact) => [fact.property, fact])
    );

    expect(Object.keys(byProperty).sort()).toEqual([
      'background',
      'color',
      'font-size',
      'gap',
      'outline-color',
      'padding',
    ]);
    expect(byProperty['padding'].value).toEqual({
      kind: 'exact',
      value: '4px',
    });
    expect(byProperty['background'].value).toEqual({
      kind: 'exact',
      value: '#111',
    });
    // An unmodeled custom property is an addressable unknown, never a guess.
    expect(byProperty['outline-color'].value.kind).toBe('unknown');
  });

  it('passes source provenance and authored spelling through', () => {
    const padding = result.facts.find((fact) => fact.property === 'padding');

    expect(padding?.provenance).toEqual([
      { file: 'src/Card.tsx', span: [67, 200] },
      { file: 'src/Card.tsx', note: 'authored as p: 1' },
    ]);
    expect(padding?.authority).toEqual({ kind: 'static-proof' });
    expect(padding?.dependencies).toEqual(['src/Card.tsx']);
  });

  it('records origin and defeats edges on the winning fact', () => {
    const padding = result.facts.find((fact) => fact.property === 'padding');
    const origin = padding?.derivation.find((edge) => edge.kind === 'origin');
    const defeats = padding?.derivation.filter(
      (edge) => edge.kind === 'defeats'
    );

    expect(origin?.ref).toBe('base-card');
    expect(origin?.note).toBe('Card · styles');
    expect(defeats?.map((edge) => edge.note)).toEqual([
      'wide declared padding: 16px — condition-false',
    ]);
  });

  it('marks an inherited fact as inherited, not as its own declaration', () => {
    const color = result.facts.find((fact) => fact.property === 'color');
    expect(color?.derivation[0]).toEqual({
      kind: 'inherited-from',
      ref: 'global-body',
      note:
        "no rule on the target declares color; inherited from 'body' in " +
        'layer anm-global',
    });
    expect(color?.value).toEqual({ kind: 'exact', value: '#111' });
  });

  it('summarises with concrete counts and states its coverage', () => {
    expect(result.summary).toContain(
      'Card at mode = light, state:Card:disabled = false, ' +
        'variant:Card:size = small, viewport.inline = 400 carries 3 classes ' +
        '(anm-Card, anm-surface, anm-Card--size-small).'
    );
    expect(result.summary).toContain('3 of 5 candidate rules are active');
    expect(result.summary).toContain('4 properties resolved on the target');
    expect(result.coverage.cellsEvaluated).toBe(1);
    expect(result.coverage.scenarioCells).toBeGreaterThan(1);
    expect(result.knowledgeDelta.newFacts).toBe(result.facts.length);
  });

  it('names the next operation concretely', () => {
    expect(
      result.nextOperations.map((operation) => operation.description)
    ).toContain('simulate removing surface#gap — the winning declaration');
    expect(
      result.nextOperations.some(
        (operation) => operation.kind === 'declare-dimension'
      )
    ).toBe(true);
  });

  it('lists the obligations that touch the target', () => {
    expect(
      result.unknowns.map((unknown) => unknown.effectClass).sort()
    ).toEqual(['dynamic-value', 'dynamic-value', 'external-css']);
  });

  it('is CONDITIONAL, not ESTABLISHED, while those obligations are open', () => {
    expect(result.unknowns.length).toBeGreaterThan(0);
    expect(result.verdict).toBe('CONDITIONAL');
  });
});

describe('inspect — point resolution', () => {
  it('accepts a named scenario', () => {
    const result = createOracle(host()).inspect({
      target: 'Card',
      at: 'compact.dark',
    });
    const background = result.facts.find(
      (fact) => fact.property === 'background'
    );
    expect(background?.value).toEqual({ kind: 'exact', value: '#eee' });
  });

  it('refuses an unknown scenario name and lists the known ones', () => {
    expect(() =>
      createOracle(host()).inspect({ target: 'Card', at: 'nope' })
    ).toThrow(/unknown named scenario 'nope' — available: compact.dark/);
  });

  it('refuses an unknown target and lists the known components', () => {
    expect(() => createOracle(host()).inspect({ target: 'Nope' })).toThrow(
      /unknown target 'Nope' — known components: src\/Card.tsx::Card/
    );
  });
});

describe('explain — unexpected value', () => {
  const wide: ScenarioPoint = { ...smallNarrow, 'viewport.inline': 900 };
  const oracle = createOracle(host());
  const result = oracle.explain({
    target: 'Card',
    at: wide,
    symptom: {
      kind: 'unexpected-value',
      detail: { property: 'padding', expected: '4px' },
    },
  });

  it('names the winner, its origin and every declaration it defeated', () => {
    expect(result.verdict).toBe('ESTABLISHED');
    expect(result.summary).toContain('padding = 16px');
    expect(result.summary).toContain('is set by wide');
    expect(result.summary).toContain(
      'base-card declared padding: 4px — lower-layer'
    );
    expect(result.summary).toContain(
      "The expected value was '4px'; the model says '16px'."
    );
  });

  it('keeps the causal claim model-relative', () => {
    expect(result.causalFindings).toEqual([
      {
        subject: 'wide#padding',
        status: 'MODEL_RELATIVE_INTERVENTION_WITNESS',
        note:
          'removing or replacing this declaration changes the outcome at ' +
          'this point under the modeled cascade — verify with simulate ' +
          'before treating it as the repair site',
      },
    ]);
  });

  it('emits a defeated-by fact for each losing declaration', () => {
    const defeated = result.facts.filter(
      (fact) => fact.subject.kind === 'declaration'
    );
    expect(defeated).toHaveLength(1);
    expect(defeated[0].subject).toEqual({
      kind: 'declaration',
      rule: 'base-card',
      property: 'padding',
    });
    expect(defeated[0].derivation).toContainEqual({
      kind: 'defeated-by',
      ref: 'wide',
      note: 'base-card declared padding: 4px — lower-layer',
    });
  });

  it('suggests the interventions that would settle it', () => {
    const descriptions = result.nextOperations.map(
      (operation) => operation.description
    );
    expect(descriptions).toContain(
      'simulate removing wide#padding — the winning declaration'
    );
    expect(descriptions).toContain(
      "simulate replacing wide#padding with '4px' — the expected value"
    );
  });

  it('is CONDITIONAL when an obligation touches the property', () => {
    const conditional = createOracle(host()).explain({
      target: 'Card',
      at: smallNarrow,
      symptom: { kind: 'unexpected-value', detail: { property: 'gap' } },
    });

    expect(conditional.verdict).toBe('CONDITIONAL');
    // `dynamic-value` is scoped to base-card#gap; `external-css` is scoped to
    // the whole `surface` rule, which is the rule that wins gap here.
    expect(
      conditional.unknowns.map((unknown) => unknown.effectClass).sort()
    ).toEqual(['dynamic-value', 'external-css']);
  });
});

describe('explain — missing declaration', () => {
  it('distinguishes "no candidate declares it" from "all inactive"', () => {
    const result = createOracle(host()).explain({
      target: 'Card',
      at: smallNarrow,
      symptom: {
        kind: 'missing-declaration',
        detail: { property: 'letter-spacing' },
      },
    });

    expect(result.verdict).toBe('ESTABLISHED');
    expect(result.summary).toContain(
      'No candidate rule declares letter-spacing for Card'
    );
    expect(result.summary).toContain("5 rules match the target's classes");
    expect(result.summary).toContain(
      'letter-spacing is not set in the modeled universe'
    );
  });

  it('names the blocked rule and the dimension that is unbound', () => {
    const result = createOracle(host()).explain({
      target: 'Card',
      at: smallNarrow,
      symptom: {
        kind: 'missing-declaration',
        detail: { property: 'border-color' },
      },
    });

    expect(result.summary).toContain(
      '1 declaration of border-color exist for this target, but none is ' +
        'active'
    );
    expect(result.summary).toContain(
      'hover would declare border-color: red under pseudo:hover = true ' +
        '(pseudo:hover is not declared in this world)'
    );
    expect(
      result.facts.some(
        (fact) =>
          fact.subject.kind === 'declaration' && fact.subject.rule === 'hover'
      )
    ).toBe(true);
  });

  it('reports the inherited fallback when there is one', () => {
    const result = createOracle(host()).explain({
      target: 'Card',
      at: smallNarrow,
      symptom: { kind: 'missing-declaration', detail: { property: 'color' } },
    });

    expect(result.summary).toContain(
      "color is inherited instead: #111 from 'body' in layer anm-global"
    );
  });

  it('answers a false premise with the winner, not a story about absence', () => {
    // padding IS set at this point — asking why it is "missing" must not
    // produce a summary asserting it is unset.
    const result = createOracle(host()).explain({
      target: 'Card',
      at: smallNarrow,
      symptom: { kind: 'missing-declaration', detail: { property: 'padding' } },
    });

    expect(result.summary).not.toContain('none is active');
    expect(result.summary).not.toContain('is not set in the modeled universe');
    expect(result.summary).toContain('is set by base-card');
  });

  it('refuses an unknown symptom kind', () => {
    expect(() =>
      createOracle(host()).explain({
        target: 'Card',
        symptom: {
          kind: 'looks-wrong',
          detail: { property: 'padding' },
        } as never,
      })
    ).toThrow(/unknown symptom kind 'looks-wrong'/);
  });

  it('requires a property in the symptom detail', () => {
    expect(() =>
      createOracle(host()).explain({
        target: 'Card',
        symptom: { kind: 'missing-declaration', detail: {} } as never,
      })
    ).toThrow(/requires detail.property/);
  });
});
