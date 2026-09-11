/**
 * Every request runs once at module scope against one shared session, in
 * order: the FIXPOINT step needs the repeated prove to follow the first one.
 */

import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { asRuleId } from '../src/core/identity';
import { applyDeltas } from '../src/core/world';
import { createOracle } from '../src/engines';
import { createAnimusHost } from '../src/host/animus/host';
import { loadAnimusArtifacts } from '../src/host/animus/loader';

import type { RenderFact } from '../src/core/fact';
import type { RuleId } from '../src/core/identity';
import type { ProbeResult } from '../src/core/probe';
import type { ScenarioDomain, ScenarioPoint } from '../src/core/scenario';
import type { WorldDelta } from '../src/core/world';
import type { SemanticDiff } from '../src/engines/diff';

const FIXTURE = join(__dirname, 'fixtures/rollup-app');

const host = createAnimusHost(loadAnimusArtifacts(FIXTURE));
const oracle = createOracle(host);

const POINT: ScenarioPoint = {
  'viewport.inline': 390,
  mode: 'dark',
  'variant:Alert:variant': 'outline',
  'variant:Alert:intent': 'danger',
};

const MODES: ScenarioDomain = {
  mode: { kind: 'finite', values: ['dark', 'light'] },
};

const OUTLINE_DANGER: ScenarioDomain = {
  ...MODES,
  'variant:Alert:variant': { kind: 'finite', values: ['outline'] },
  'variant:Alert:intent': { kind: 'finite', values: ['danger'] },
};

const factFor = (result: ProbeResult, property: string): RenderFact => {
  const found = result.facts.find((fact) => fact.property === property);
  if (found === undefined) {
    throw new Error(`fixture: expected a '${property}' fact, found none`);
  }
  return found;
};

const originOf = (fact: RenderFact): RuleId => {
  const edge = fact.derivation.find(
    (candidate) =>
      candidate.kind === 'origin' || candidate.kind === 'inherited-from'
  );
  if (edge === undefined) throw new Error('fixture: fact has no origin edge');
  return asRuleId(edge.ref);
};

const semanticDiffOf = (result: ProbeResult): SemanticDiff => {
  const diff = result.semanticDiff;
  if (diff === undefined) throw new Error('fixture: result carries no diff');
  return diff;
};

const inspected = oracle.inspect({ target: 'Alert', at: POINT });
const colorFact = factFor(inspected, 'color');
const compoundRule = originOf(colorFact);

const explained = oracle.explain({
  target: 'Alert',
  at: POINT,
  symptom: {
    kind: 'unexpected-value',
    detail: { property: 'color', expected: '#111827' },
  },
});

const removal: readonly WorldDelta[] = [
  { kind: 'remove-declaration', rule: compoundRule, property: 'color' },
];
const simulated = oracle.simulate({
  target: 'Alert',
  at: POINT,
  deltas: removal,
});
const candidateWorld = applyDeltas(oracle.baselineWorld(), removal);
const afterRemoval = oracle.inspect({
  target: 'Alert',
  at: POINT,
  world: candidateWorld,
});

const diffed = oracle.diff({ target: 'Alert', candidate: { deltas: removal } });

const proved = oracle.prove({
  assertions: [
    { kind: 'mode-invariant', target: 'Alert', property: 'padding' },
  ],
  domain: MODES,
});
const disproved = oracle.prove({
  assertions: [
    {
      kind: 'effective-value',
      target: 'Alert',
      property: 'color',
      expected: '#ef4444',
    },
  ],
  domain: OUTLINE_DANGER,
});

const repeated = oracle.prove({
  assertions: [
    {
      kind: 'effective-value',
      target: 'Alert',
      property: 'color',
      expected: '#ef4444',
    },
  ],
  domain: OUTLINE_DANGER,
});

const card = oracle.inspect({
  target: 'Card',
  at: { 'viewport.inline': 390, mode: 'dark' },
});
const cardPadding = oracle.prove({
  assertions: [
    {
      kind: 'effective-value-in',
      target: 'Card',
      property: 'padding',
      allowed: ['1rem', '1.5rem'],
    },
  ],
  domain: MODES,
});
const geometryObligation = cardPadding.unknowns.find(
  (unknown) => unknown.effectClass === 'geometry'
);
const refined =
  geometryObligation === undefined
    ? undefined
    : oracle.refine({ obligation: geometryObligation.id });

const EVERY_RESULT: readonly ProbeResult[] = [
  inspected,
  explained,
  simulated,
  afterRemoval,
  diffed,
  proved,
  disproved,
  repeated,
  card,
  cardPadding,
  ...(refined === undefined ? [] : [refined]),
];

describe('§12.1 inspect — effective declarations, winners, provenance', () => {
  it('establishes the compound rule as the winner of color', () => {
    expect(inspected.verdict).toBe('ESTABLISHED');
    expect(colorFact.value).toEqual({ kind: 'exact', value: '#ef4444' });

    const rule = host.universe.universe().ruleById(compoundRule);
    expect(rule?.layer).toBe('anm-compounds');
    expect(rule?.selector.raw).toBe('.animus-Alert-a385f997--compound-1');
    expect(rule?.origin?.method).toBe('compound');
  });

  it('resolves the value through --color-danger under the dark mode', () => {
    const token = colorFact.derivation.find(
      (edge) => edge.ref === 'token:--color-danger'
    );
    expect(token?.note).toBe("--color-danger = #ef4444 under mode 'dark'");
    // Vacuity guard: the token is mode-dependent, not a constant.
    expect(host.tokens?.resolve('--color-danger', 'light')?.value).toBe(
      '#b91c1c'
    );
  });

  it('carries byte-exact source provenance back to Alert.tsx', () => {
    const [source] = colorFact.provenance;
    expect(source.file.endsWith('Alert.tsx')).toBe(true);
    expect(source.span).toEqual([716, 758]);
    expect(colorFact.provenance[1]).toEqual({
      file: source.file,
      note: 'authored as color: danger',
    });
    expect(colorFact.authority).toEqual({ kind: 'static-proof' });
  });

  it('reports the defeated candidates with the reason each lost', () => {
    const background = factFor(inspected, 'background-color');
    const defeats = background.derivation.filter(
      (edge) => edge.kind === 'defeats'
    );
    expect(defeats).toHaveLength(1);
    expect(defeats[0].note).toMatch(
      /declared background-color: transparent — earlier-order$/
    );
    expect(inspected.summary).toContain('2 declarations defeated');

    // Candidacy is structural: the outline point never carries the filled
    // variant's class, so its color declaration is not even a candidate.
    expect(colorFact.derivation.filter((e) => e.kind === 'defeats')).toEqual(
      []
    );
  });

  it('has no unresolved obligation touching this target', () => {
    expect(inspected.unknowns).toEqual([]);
    expect(inspected.coverage.cellsEvaluated).toBe(1);
    // 3 variants × 2 intents × 2 modes × 7 viewport bands.
    expect(inspected.coverage.scenarioCells).toBe(84);
  });
});

describe('§12.2 explain — the backward slice names the intervention site', () => {
  it('names the compound rule as a model-relative intervention witness', () => {
    expect(explained.verdict).toBe('ESTABLISHED');
    expect(explained.causalFindings).toEqual([
      {
        subject: `${compoundRule}#color`,
        status: 'MODEL_RELATIVE_INTERVENTION_WITNESS',
        note:
          'removing or replacing this declaration changes the outcome at ' +
          'this point under the modeled cascade — verify with simulate ' +
          'before treating it as the repair site',
      },
    ]);
  });

  it('states the source span, the token chain and the expectation gap', () => {
    expect(explained.summary).toContain(`is set by ${compoundRule}`);
    expect(explained.summary).toContain('Alert.tsx:716-758');
    expect(explained.summary).toContain(
      'The value resolves through --color-danger.'
    );
    expect(explained.summary).toContain(
      "The expected value was '#111827'; the model says '#ef4444'."
    );
  });

  it('suggests the simulation that would settle it', () => {
    const descriptions = explained.nextOperations.map(
      (operation) => operation.description
    );
    expect(explained.nextOperations.map((o) => o.kind)).toContain(
      'simulate-removal'
    );
    expect(descriptions).toContain(
      `simulate removing ${compoundRule}#color — the winning declaration`
    );
  });
});

describe('§12.3 simulate — the hypothetical world and its collateral', () => {
  it('moves the winner to the inherited global declaration', () => {
    const color = factFor(afterRemoval, 'color');
    expect(color.value).toEqual({ kind: 'exact', value: '#f5f5f5' });
    expect(color.derivation[0].kind).toBe('inherited-from');
    expect(color.derivation[0].note).toBe(
      "no rule on the target declares color; inherited from 'body' in layer " +
        'anm-global'
    );
    // Vacuity guard: the baseline value differs, so the winner really moves.
    expect(colorFact.value).toEqual({ kind: 'exact', value: '#ef4444' });
  });

  it('reports the change through an exhaustive collateral sweep', () => {
    const diff = semanticDiffOf(simulated);
    const moved = diff.entries.filter((entry) => entry.property === 'color');

    expect(simulated.verdict).toBe('ESTABLISHED');
    expect(moved.length).toBeGreaterThan(0);
    expect(moved[0].before).toBe('#ef4444');
    expect(moved[0].after).toBe('#f5f5f5');
    expect(moved[0].kind).toBe('rule-activated');
    expect(simulated.summary).toContain('Properties moved: color.');
    expect(simulated.summary).toContain('in 10 components');
    // Vacuity guard: the sweep visits far more than the probed cell.
    expect(simulated.coverage.cellsEvaluated).toBeGreaterThan(100);
  });

  it('keeps the causal claim model-relative (DESIGN §7)', () => {
    expect(simulated.causalFindings?.[0]).toMatchObject({
      subject: `remove color from rule ${compoundRule}`,
      status: 'MODEL_RELATIVE_INTERVENTION_WITNESS',
    });
    expect(simulated.causalFindings?.[0].note).toContain(
      'not a claim that it is the rule to change'
    );
  });
});

describe('§12.4 diff — classified changes, affected context classes only', () => {
  it('classifies the colour change and scopes it to its context class', () => {
    const diff = semanticDiffOf(diffed);
    const colors = diff.entries.filter((entry) => entry.property === 'color');

    // 14 = 2 modes × 7 viewport bands of the danger cells; both modes appear
    // because the removal exposes the per-mode inherited body colour.
    expect(colors).toHaveLength(14);
    expect(new Set(colors.map((entry) => entry.kind))).toEqual(
      new Set(['rule-activated'])
    );
    expect(new Set(colors.map((entry) => entry.before)).size).toBe(2);
    expect(new Set(colors.map((entry) => entry.before))).toEqual(
      new Set(['#ef4444', '#b91c1c'])
    );
    expect(new Set(colors.map((entry) => entry.after))).toEqual(
      new Set(['#f5f5f5', '#171717'])
    );
    for (const entry of colors) {
      expect(entry.context).toContain('variant:Alert:intent = danger');
    }
    expect(diff.affectedContextClasses).toBeGreaterThanOrEqual(1);
    expect(diff.unaffectedContextClasses).toBeGreaterThan(0);
  });
});

describe('§12.5 prove — an invariant, then a counterexample', () => {
  it('proves padding is mode-invariant over the whole domain', () => {
    expect(proved.verdict).toBe('PROVED');
    expect(proved.unknowns).toEqual([]);
    // Vacuity guard: 3 variants × 2 intents × 2 modes × 7 viewport bands; a
    // single-cell sweep makes mode-invariance hold vacuously.
    expect(proved.coverage.cellsEvaluated).toBe(84);
    expect(proved.summary).toContain(
      'PROVED under this program revision, scenario domain, environment ' +
        'profile and model version — not beyond them.'
    );
  });

  it('disproves the colour with a minimized counterexample', () => {
    expect(disproved.verdict).toBe('DISPROVED');
    // 2 modes × 7 viewport bands at the pinned outline/danger coordinates.
    expect(disproved.coverage.cellsEvaluated).toBe(14);
    expect(disproved.witnesses).toHaveLength(1);
    expect(disproved.witnesses?.[0].point.mode).toBe('light');
    expect(disproved.witnesses?.[0].violation).toContain(
      "color = '#b91c1c' (expected '#ef4444')"
    );
    expect(disproved.witnesses?.[0].violation).toContain(compoundRule);
    expect(disproved.nextOperations.map((o) => o.kind)).toContain('explain');
  });
});

describe('§12.6 fixpoint — repetition cannot look like progress', () => {
  it('answers FIXPOINT with the prior state and a zeroed delta', () => {
    expect(repeated.verdict).toBe('FIXPOINT');
    expect(repeated.previous).toBe(disproved.probeStateId);
    expect(repeated.probeStateId).toBe(disproved.probeStateId);
    expect(repeated.knowledgeDelta).toEqual({
      newFacts: 0,
      precisionImprovements: 0,
      candidatesEliminated: 0,
      newObligations: 0,
    });
    expect(repeated.nextOperations).toEqual(disproved.nextOperations);
    // Vacuity guard: the first probe of that state learns something.
    expect(disproved.knowledgeDelta.newFacts).toBeGreaterThan(0);
  });
});

describe('shared axes are part of every target domain', () => {
  it('disproves a mode-invariance the target does not have', () => {
    // The default target domain must carry the mode axis; without it this
    // disproof is vacuous over zero mode cells.
    const fresh = createOracle(createAnimusHost(loadAnimusArtifacts(FIXTURE)));
    const result = fresh.prove({
      assertions: [
        { kind: 'mode-invariant', target: 'Alert', property: 'color' },
      ],
    });

    expect(result.verdict).toBe('DISPROVED');
    expect(result.witnesses?.[0]?.violation).toMatch(/under mode = /);
  });
});

describe('§12.7 geometry — an addressable obligation, not a number', () => {
  it('never invents a value for a container-dependent property', () => {
    // A geometry unknown touching this target makes even an inspect reading
    // CONDITIONAL.
    expect(card.verdict).toBe('CONDITIONAL');
    expect(card.summary).toContain('6 conditionally-inactive');
    // `@container card (width>=400px) { width: 50cqw }` is a candidate rule
    // whose guard has no bindable dimension; no width fact may exist at all.
    expect(card.facts.map((fact) => fact.property)).not.toContain('width');
    expect(card.unknowns.map((unknown) => unknown.effectClass)).toContain(
      'geometry'
    );
  });

  it('refuses PROVED while the geometry obligation is open', () => {
    expect(cardPadding.verdict).toBe('CONDITIONAL');
    expect(cardPadding.summary).toContain('CONDITIONAL, not PROVED.');
    expect(geometryObligation).toBeDefined();
    expect(geometryObligation?.effectClass).toBe('geometry');
    expect(geometryObligation?.dischargeOptions.length ?? 0).toBeGreaterThan(0);
    expect(geometryObligation?.reason).toContain('container query');
  });

  it('keeps the unknown addressable: refine names the cheapest procedure', () => {
    expect(refined?.verdict).toBe('CONDITIONAL');
    expect(refined?.summary).toContain('remains open');
    expect(refined?.nextOperations.map((o) => o.kind)).toEqual([
      'discharge:context-capsule-measurement',
    ]);
    expect(refined?.facts).toEqual([]);
  });
});

describe('the invariants that hold across the whole path', () => {
  const GEOMETRY_PROPERTIES = [
    'width',
    'height',
    'inline-size',
    'block-size',
    'min-height',
    'max-width',
  ];

  it('never states an exact geometry value for a container-dependent one', () => {
    const fabricated = EVERY_RESULT.flatMap((result) =>
      result.facts.filter(
        (fact) =>
          GEOMETRY_PROPERTIES.includes(fact.property) &&
          fact.value.kind === 'exact'
      )
    );
    expect(fabricated).toEqual([]);
    // Vacuity guard: the sweep looks at a non-empty set of facts.
    expect(
      EVERY_RESULT.reduce((total, result) => total + result.facts.length, 0)
    ).toBeGreaterThan(20);
  });

  it('never reports PROVED alongside an intersecting unknown', () => {
    for (const result of EVERY_RESULT) {
      if (result.verdict !== 'PROVED') continue;
      expect(result.unknowns).toEqual([]);
    }
    // Vacuity guard: at least one result in the path is PROVED.
    expect(EVERY_RESULT.some((result) => result.verdict === 'PROVED')).toBe(
      true
    );
  });

  it('scopes every answer to the same program revision', () => {
    expect(host.program.kind).toBe('analysis-artifacts');
    expect(host.program.label).toBe(
      'animus-commit:b06d23b64b8afc57701072492fe0ec10'
    );
    for (const result of EVERY_RESULT) {
      expect(result.probeStateId).toMatch(/^[0-9a-f]{16}$/);
    }
  });
});
