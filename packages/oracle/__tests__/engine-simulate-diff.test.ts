import { describe, expect, it } from 'vitest';

import { asRuleId } from '../src/core/identity';
import { TRUE } from '../src/core/predicate';
import { applyDeltas } from '../src/core/world';
import { createOracle } from '../src/engines';
import { createInMemoryHost } from '../src/providers/in-memory';
import { config, host, smallNarrow } from './fixture-world';

import type { ProbeResult } from '../src/core/probe';
import type { ScenarioPoint } from '../src/core/scenario';
import type { SemanticDiff } from '../src/engines';
import type { InMemoryHostConfig } from '../src/providers/in-memory';
import type {
  TokenDefinition,
  TokenProvider,
  TokenResolution,
} from '../src/providers/tokens';

const large: ScenarioPoint = {
  ...smallNarrow,
  'variant:Card:size': 'large',
};

const contextsOf = (entries: readonly { context: string }[]): string[] =>
  Array.from(new Set(entries.map((entry) => entry.context.split(' @ ')[0])));

/**
 * `ProbeResult.semanticDiff` is typed `SemanticDiff` and OPTIONAL — present
 * exactly when the operation compared two worlds. Every operation asked here
 * compares, so absence is a fixture error, not a shape question.
 */
const semanticDiffOf = (result: ProbeResult): SemanticDiff => {
  const diff = result.semanticDiff;
  if (diff === undefined) {
    throw new Error('fixture: this operation must attach a semantic diff');
  }
  return diff;
};

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
    const padding = semanticDiffOf(result).entries.filter(
      (entry) => entry.property === 'padding'
    );

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
  const entries = semanticDiffOf(result).entries;

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
    const activated = semanticDiffOf(result).entries.filter(
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
    const entries = semanticDiffOf(result).entries;
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
    const diff = semanticDiffOf(result);
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
  const ALIASED = new Map<string, TokenDefinition>([
    [
      '--space-4',
      {
        variable: '--space-4',
        valuesByMode: { root: '16px' },
        references: [],
      },
    ],
    [
      '--space-md',
      {
        variable: '--space-md',
        valuesByMode: { root: 'var(--space-4)' },
        references: ['--space-4'],
      },
    ],
  ]);

  const aliasTokens = (): TokenProvider => ({
    modes: () => ['light', 'dark'],
    defaultMode: () => 'light',
    token: (variable) => ALIASED.get(variable),
    all: () => [...ALIASED.values()],
    resolve: (variable, mode): TokenResolution | undefined => {
      const chain: string[] = [];
      let current = variable;
      for (let depth = 0; depth < 8; depth += 1) {
        chain.push(current);
        const definition = ALIASED.get(current);
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

    const margins = semanticDiffOf(result).entries.filter(
      (entry) => entry.property === 'margin'
    );

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
