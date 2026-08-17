import { describe, expect, it } from 'vitest';

import { createOracle } from '../src/engines';
import { host, smallNarrow } from './fixture-world';

import type { ScenarioPoint } from '../src/core/scenario';
import type { OracleSymptom } from '../src/engines';

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

  /**
   * `explain` re-checks its symptom at runtime because callers also reach it
   * through the JSON surface, where the declared union guarantees nothing.
   * Exercising a refusal therefore needs a value the union forbids: start
   * from a valid symptom and install one own property at runtime, with the
   * key order and descriptor flags an object literal would have given it.
   */
  const symptomWith = (
    field: 'kind' | 'detail',
    value: string | Readonly<Record<string, string>>
  ): OracleSymptom => {
    const symptom: OracleSymptom = {
      kind: 'missing-declaration',
      detail: { property: 'padding' },
    };
    Object.defineProperty(symptom, field, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
    return symptom;
  };

  it('refuses an unknown symptom kind', () => {
    expect(() =>
      createOracle(host()).explain({
        target: 'Card',
        symptom: symptomWith('kind', 'looks-wrong'),
      })
    ).toThrow(/unknown symptom kind 'looks-wrong'/);
  });

  it('requires a property in the symptom detail', () => {
    expect(() =>
      createOracle(host()).explain({
        target: 'Card',
        symptom: symptomWith('detail', {}),
      })
    ).toThrow(/requires detail.property/);
  });
});
