import { describe, expect, it } from 'vitest';

import { ObligationRegistry } from '../src/core/obligation';
import { eq, range, TRUE } from '../src/core/predicate';
import { describeValue } from '../src/core/value';
import {
  analyzeCascade,
  INHERITABLE_PROPERTIES,
  resolveDeclarationValue,
  specificityOf,
  speculate,
} from '../src/engines';
import { createInMemoryHost } from '../src/providers/in-memory';

import type { ScenarioPoint } from '../src/core/scenario';
import type { CascadeContext, DefeatReason } from '../src/engines';
import type { OracleHost } from '../src/providers/host';
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

const smallNarrow: ScenarioPoint = {
  mode: 'light',
  'viewport.inline': 400,
  'variant:Card:size': 'small',
  'state:Card:disabled': false,
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
): Record<string, DefeatReason> => {
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
