import { describe, expect, it } from 'vitest';

import { ObligationRegistry } from '../src/core/obligation';
import { describeValue } from '../src/core/value';
import {
  analyzeCascade,
  INHERITABLE_PROPERTIES,
  resolveDeclarationValue,
  specificityOf,
  speculate,
} from '../src/engines';
import { createInMemoryHost } from '../src/providers/in-memory';
import { config, smallNarrow, tokens } from './fixture-world';

import type { ScenarioPoint } from '../src/core/scenario';
import type { CascadeContext, DefeatReason } from '../src/engines';
import type { OracleHost } from '../src/providers/host';
import type { FixtureOptions } from './fixture-world';

/** The shared world WITHOUT the host's declared obligations: this suite
 *  drives its own `ObligationRegistry` through `contextOf`, so declared
 *  obligations must not be registered into the universe behind it. */
const host = (options: FixtureOptions = {}): OracleHost => ({
  ...createInMemoryHost(config(options)),
  tokens: tokens(),
});

const contextOf = (built: OracleHost): CascadeContext => ({
  universe: speculate(built, []).universe,
  tokens: built.tokens,
  scenario: built.scenarios.dimensions(),
  obligations: new ObligationRegistry(),
  dependencies: built.dependencies,
});

const cascadeAt = (built: OracleHost, point: ScenarioPoint) => {
  const resolution = built.identity.resolveTarget('Card');
  if (resolution === undefined) throw new Error('fixture: Card must resolve');
  return analyzeCascade(contextOf(built), resolution, point);
};

const winnerOfProperty = (
  analysis: ReturnType<typeof cascadeAt>,
  property: string
) => {
  const winner = analysis.outcomes.get(property)?.winner;
  if (winner === undefined) return undefined;
  return {
    rule: winner.candidate.rule.id,
    value: winner.declaration.value,
  };
};

const reasonsFor = (
  analysis: ReturnType<typeof cascadeAt>,
  property: string
) => {
  const reasons: Record<string, DefeatReason> = {};
  for (const defeated of analysis.outcomes.get(property)?.defeated ?? []) {
    reasons[defeated.declaration.candidate.rule.id] = defeated.reason;
  }
  return reasons;
};

describe('cascade — precedence', () => {
  it('lets a later layer beat an earlier one', () => {
    const analysis = cascadeAt(host(), {
      ...smallNarrow,
      'viewport.inline': 900,
    });

    expect(winnerOfProperty(analysis, 'padding')).toEqual({
      rule: 'wide',
      value: '16px',
    });
    expect(reasonsFor(analysis, 'padding')['base-card']).toBe('lower-layer');
  });

  it('lets specificity beat rule order inside one layer', () => {
    const analysis = cascadeAt(host(), {
      ...smallNarrow,
      'variant:Card:size': 'large',
      'viewport.inline': 900,
    });

    // `variant-large-strong` is emitted FIRST (order 0) yet wins on b=2.
    expect(winnerOfProperty(analysis, 'padding')).toEqual({
      rule: 'variant-large-strong',
      value: '20px',
    });
    expect(reasonsFor(analysis, 'padding')).toEqual({
      'base-card': 'lower-layer',
      'variant-large': 'lower-specificity',
      wide: 'lower-specificity',
    });
    expect(
      specificityOf({
        raw: '.anm-Card.anm-Card--size-large',
        classNames: ['anm-Card', 'anm-Card--size-large'],
      })
    ).toEqual({ b: 2, c: 0 });
  });

  it('reports earlier-order when layer and specificity tie', () => {
    const analysis = cascadeAt(host(), smallNarrow);

    expect(winnerOfProperty(analysis, 'gap')).toEqual({
      rule: 'surface',
      value: '5px',
    });
    expect(reasonsFor(analysis, 'gap')['base-card']).toBe('earlier-order');
  });

  it('reverses the layer order for !important declarations', () => {
    const analysis = cascadeAt(host({ important: true }), {
      ...smallNarrow,
      'viewport.inline': 900,
    });

    // Both important: anm-base is EARLIER than anm-variants, so it wins.
    expect(winnerOfProperty(analysis, 'padding')).toEqual({
      rule: 'base-important',
      value: '1px',
    });
    expect(reasonsFor(analysis, 'padding')).toEqual({
      'base-card': 'overridden-by-important',
      wide: 'overridden-by-important',
      'variants-important': 'lower-layer',
    });
  });

  it('marks a candidate whose guard is false as condition-false', () => {
    const analysis = cascadeAt(host(), smallNarrow);

    // `wide` matches the class set but its viewport guard is false here …
    expect(reasonsFor(analysis, 'padding')['wide']).toBe('condition-false');
    // … while the variant rules are not candidates: the class is absent.
    expect(
      analysis.candidates.map((candidate) => candidate.rule.id)
    ).not.toContain('variant-large');
    expect(winnerOfProperty(analysis, 'padding')).toEqual({
      rule: 'base-card',
      value: '4px',
    });
  });
});

describe('cascade — pseudo classes and elements', () => {
  it('is inactive and reported when the pseudo axis is unbound', () => {
    const analysis = cascadeAt(host(), smallNarrow);
    const hover = analysis.candidates.find(
      (candidate) => candidate.rule.id === 'hover'
    );

    expect(hover?.active).toBe(false);
    expect(hover?.conditional).toBe(true);
    expect(hover?.unboundInWorld).toEqual(['pseudo:hover']);
    expect(analysis.assumptions).toContain(
      '1 rule guarded by pseudo:hover — dimension unbound in this world'
    );
    expect(winnerOfProperty(analysis, 'border-color')).toBeUndefined();
  });

  it('is active once the pseudo axis is declared and bound', () => {
    const analysis = cascadeAt(host({ pseudoDimension: true }), {
      ...smallNarrow,
      'pseudo:hover': true,
    });

    expect(winnerOfProperty(analysis, 'border-color')).toEqual({
      rule: 'hover',
      value: 'red',
    });
    expect(
      analysis.assumptions.some((assumption) =>
        assumption.includes('pseudo:hover')
      )
    ).toBe(false);
  });

  it('splits a pseudo-element rule off into its own subject', () => {
    const analysis = cascadeAt(host(), smallNarrow);

    expect(analysis.pseudoElementRules.map((entry) => entry.rule.id)).toEqual([
      'marker',
    ]);
    expect(analysis.outcomes.has('content')).toBe(false);
    expect(analysis.assumptions).toContain(
      'rule marker targets the ::before pseudo-element — a distinct ' +
        "subject, excluded from this element's own cascade"
    );
  });
});

describe('cascade — value resolution', () => {
  const backgroundAt = (point: ScenarioPoint) => {
    const built = host();
    const ctx = contextOf(built);
    const analysis = cascadeAt(built, point);
    const winner = analysis.outcomes.get('background')?.winner;
    if (winner === undefined) throw new Error('background must have a winner');
    return resolveDeclarationValue(ctx, point, winner);
  };

  it('resolves a token chain per mode', () => {
    expect(describeValue(backgroundAt(smallNarrow).value)).toBe('#111');
    expect(
      describeValue(backgroundAt({ ...smallNarrow, mode: 'dark' }).value)
    ).toBe('#eee');
    expect(backgroundAt(smallNarrow).tokenChains).toEqual([
      ['--surface-bg', '--color-text'],
    ]);
  });

  it('falls back to the default mode and says so', () => {
    const resolved = backgroundAt({ 'viewport.inline': 400 });
    expect(describeValue(resolved.value)).toBe('#111');
    expect(resolved.assumptions).toEqual([
      'mode is unbound at this point — token values resolved under the ' +
        "default mode 'light'",
    ]);
  });

  it('turns an unmodeled custom property into an obligation', () => {
    const built = host();
    const ctx = contextOf(built);
    const analysis = cascadeAt(built, smallNarrow);
    const winner = analysis.outcomes.get('outline-color')?.winner;
    if (winner === undefined) throw new Error('outline-color must resolve');

    const resolved = resolveDeclarationValue(ctx, smallNarrow, winner);
    expect(resolved.value.kind).toBe('unknown');
    expect(resolved.raised).toHaveLength(1);
    expect(resolved.raised[0].effectClass).toBe('dynamic-value');
    expect(resolved.raised[0].reason).toContain('--missing');
    expect(ctx.obligations.all()).toHaveLength(1);
  });
});

describe('cascade — inheritance', () => {
  it('falls back to an element-selector rule for inheritables', () => {
    const analysis = cascadeAt(host(), smallNarrow);
    const inherited = analysis.inherited.get('color');

    expect(INHERITABLE_PROPERTIES).toContain('color');
    expect(inherited?.declaration.candidate.rule.id).toBe('global-body');
    expect(
      analysis.inherited.get('font-size')?.declaration.declaration.value
    ).toBe('16px');
    // Not inheritable, and not declared on the target: no fact at all.
    expect(analysis.inherited.has('background')).toBe(false);
  });

  it('does not inherit when the target sets the property itself', () => {
    const built = host();
    const analysis = cascadeAt(built, smallNarrow);
    expect(analysis.outcomes.get('padding')?.winner).toBeDefined();
    expect(analysis.inherited.has('padding')).toBe(false);
  });
});
