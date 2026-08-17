import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { referencedDimensions } from '../src/core/predicate';
import { AnimusAdapterError } from '../src/host/animus/errors';
import { createAnimusHost } from '../src/host/animus/host';
import { loadAnimusArtifacts } from '../src/host/animus/loader';
import { asManifest } from '../src/host/animus/manifest-types';

import type { AnimusHostInput } from '../src/host/animus/host';
import type { StyleRuleRecord } from '../src/providers/style-universe';

const FIXTURE = join(__dirname, 'fixtures/rollup-app');

const input = loadAnimusArtifacts(FIXTURE);
const host = createAnimusHost(input);
const universe = host.universe.universe();

/** The adapter's own reading of the fixture manifest — the same validating
 *  narrow `createAnimusHost` performs, so the variants below start from the
 *  emitter's contract instead of a locally restated slice of it. */
const manifest = asManifest(input.manifest);

/**
 * The fixture manifest with one sheet added or replaced. `sheets` is read per
 * key, so a variant is a new map rather than a mutated fixture — the shared
 * `input` stays the artifact every other test in this file reads.
 */
const withSheet = (name: string, css: string): AnimusHostInput => ({
  manifest: { ...manifest, sheets: { ...manifest.sheets, [name]: css } },
});

const ALERT_FILE = '../../packages/test-ds/src/components/Alert.tsx';

const bySelector = (raw: string): StyleRuleRecord[] =>
  universe.rules.filter((rule) => rule.selector.raw === raw);

describe('createAnimusHost — the style universe over the emitted artifacts', () => {
  it('builds without throwing and models every emitted layer', () => {
    const byLayer = new Map<string, number>();
    for (const rule of universe.rules) {
      byLayer.set(rule.layer, (byLayer.get(rule.layer) ?? 0) + 1);
    }

    expect(universe.rules.length).toBeGreaterThan(40);
    expect(Object.fromEntries(byLayer)).toEqual({
      'anm-global': 4,
      'anm-base': 21,
      'anm-variants/standalone': 13,
      'anm-compounds': 3,
      'anm-states': 2,
      'anm-system': 268,
    });
    // Every modeled layer has to be rankable, or its rules sit outside the
    // precedence contract in `providers/style-universe.ts`.
    for (const layer of byLayer.keys()) {
      expect(universe.layerOrder).toContain(layer);
    }
    expect(host.program).toMatchObject({ kind: 'analysis-artifacts' });
    expect(host.program.label).toBe(
      'animus-commit:410fa0bb91141167e1cad2d6cd6dd150'
    );
  });

  it('ranks sub-layers below the unlayered content of their parent', () => {
    expect(universe.layerOrder).toEqual([
      'anm-global',
      'anm-base',
      'anm-variants/standalone',
      'anm-variants/composed',
      'anm-variants',
      'anm-compounds',
      'anm-states',
      'anm-system',
      'anm-custom',
    ]);

    const standalone = universe.rules.filter(
      (rule) => rule.layer === 'anm-variants/standalone'
    );
    const composed = universe.rules.filter(
      (rule) => rule.layer === 'anm-variants/composed'
    );
    expect(standalone.length).toBeGreaterThan(0);
    // `@layer composed` is emitted and empty in this fixture — the declared
    // sub-layer still has to hold its rank, or a later composed rule would
    // silently change every neighbouring rule's precedence.
    expect(composed).toHaveLength(0);
    expect(universe.layerOrder.indexOf('anm-variants/composed')).toBeLessThan(
      universe.layerOrder.indexOf('anm-variants')
    );
  });

  it('attributes a variant rule to its prop, option, tokens and source', () => {
    const [rule] = bySelector('.animus-Alert-a385f997--intent-danger');

    expect(rule.layer).toBe('anm-variants/standalone');
    expect(rule.condition).toEqual({ kind: 'true' });
    expect(rule.origin).toEqual({
      component: `${ALERT_FILE}::Alert`,
      method: 'variant',
      variantProp: 'intent',
      variantOption: 'danger',
    });

    const background = rule.declarations.find(
      (declaration) => declaration.property === 'background-color'
    );
    expect(background).toEqual({
      property: 'background-color',
      value: 'var(--color-danger)',
      tokenRefs: ['--color-danger'],
      authoredProperty: 'bg',
      authoredValue: 'danger',
    });

    expect(rule.source?.file.endsWith('Alert.tsx')).toBe(true);
    const chain = host.identity.componentById(`${ALERT_FILE}::Alert`)?.source
      ?.span;
    expect(chain).toBeDefined();
    const [start, end] = rule.source?.span ?? [-1, -1];
    expect(start).toBeGreaterThanOrEqual((chain ?? [0, 0])[0]);
    expect(end).toBeLessThanOrEqual((chain ?? [0, 0])[1]);
    expect(start).toBeLessThan(end);
  });

  it('attributes compound and state rules through the same grammar', () => {
    const [compound] = bySelector('.animus-Alert-a385f997--compound-1');
    expect(compound.origin).toMatchObject({
      method: 'compound',
      compoundIndex: 1,
    });
    // The compound's *styles* are its second argument, not its conditions.
    expect(compound.declarations.map((d) => d.authoredProperty)).toEqual([
      'borderColor',
      'color',
    ]);

    const [state] = bySelector('.animus-Badge-99781d29--disabled');
    expect(state.layer).toBe('anm-states');
    expect(state.origin).toMatchObject({ method: 'states', state: 'disabled' });
  });

  it('guards a responsive system rule by the viewport interval', () => {
    const [rule] = bySelector('.animus-dyn-p-md');

    expect(rule.layer).toBe('anm-system');
    expect(rule.origin).toEqual({ method: 'system', systemProp: 'p' });
    expect(rule.condition).toEqual({
      kind: 'range',
      dim: 'viewport.inline',
      min: 768,
      minInclusive: true,
    });
    expect(rule.declarations).toEqual([
      {
        property: 'padding',
        value: 'var(--animus-p-md)',
        tokenRefs: ['--animus-p-md'],
      },
    ]);
    expect(host.scenarios.cuts()['viewport.inline']).toEqual([640, 768, 1024]);
  });

  it('puts container queries on a geometry-coupled, unbound dimension', () => {
    const containerRules = universe.rules.filter((rule) =>
      referencedDimensions(rule.condition).includes(
        'container:card:inline-size'
      )
    );

    expect(containerRules.length).toBeGreaterThan(0);
    expect(host.scenarios.cuts()['container:card:inline-size']).toEqual([
      400, 600,
    ]);
    expect(Object.keys(host.scenarios.dimensions())).not.toContain(
      'container:card:inline-size'
    );

    const geometry = host
      .obligations()
      .filter((obligation) => obligation.effectClass === 'geometry');
    expect(geometry.length).toBe(containerRules.length);
    const scoped = geometry.flatMap((obligation) =>
      obligation.influenceScope.map((subject) =>
        subject.kind === 'rule' ? subject.rule : ''
      )
    );
    for (const rule of containerRules) expect(scoped).toContain(rule.id);
  });

  it('carries @supports as its own opaque dimension', () => {
    const supported = universe.rules.filter((rule) =>
      referencedDimensions(rule.condition).some((dim) =>
        dim.startsWith('supports:')
      )
    );

    expect(supported.length).toBeGreaterThan(0);
    for (const rule of supported) {
      expect(referencedDimensions(rule.condition)).toContain(
        'supports:(display: grid)'
      );
    }
  });

  it('keeps pseudo-classes on the selector model, not on the guard', () => {
    const [rule] = bySelector('.animus-Card-9aa7af5d:focus-visible');

    expect(rule.selector.pseudo).toEqual([':focus-visible']);
    expect(rule.selector.classNames).toEqual(['animus-Card-9aa7af5d']);
    expect(referencedDimensions(rule.condition)).toEqual([
      'supports:(display: grid)',
    ]);
  });

  it('names what it does not model instead of implying completeness', () => {
    expect(universe.exclusions.join('\n')).toMatch(/inline `style=`/);
    expect(universe.exclusions.join('\n')).toMatch(/invocation identity/);
    expect(universe.exclusions.join('\n')).toMatch(/@keyframes/);
    expect(universe.exclusions.join('\n')).toMatch(/prefers-color-scheme/);
    expect(universe.exclusions.join('\n')).toMatch(/relational selector/);
  });

  it('is deterministic: the same input yields the same rule ids', () => {
    const again = createAnimusHost(loadAnimusArtifacts(FIXTURE))
      .universe.universe()
      .rules.map((rule) => rule.id);

    expect(again).toEqual(universe.rules.map((rule) => rule.id));
    expect(new Set(again).size).toBe(again.length);
    expect(createAnimusHost(input).program.hash).toBe(host.program.hash);
  });

  it('refuses an unmodeled construct in a sheet instead of skipping it', () => {
    const corrupt = withSheet(
      'base',
      '@layer anm-base {\n@scope (.a) { .b { color: red; } }\n}'
    );

    expect(() => createAnimusHost(corrupt)).toThrow(AnimusAdapterError);
    expect(() => createAnimusHost(corrupt)).toThrow(/@scope/);
  });

  it('refuses a manifest with no sheets instead of a confident empty universe', () => {
    const { sheets, ...thin } = manifest;
    // Vacuity guard: the fixture really did carry the map being removed.
    expect(Object.keys(sheets).length).toBeGreaterThan(0);

    expect(() => createAnimusHost({ manifest: thin })).toThrow(
      AnimusAdapterError
    );
    expect(() => createAnimusHost({ manifest: thin })).toThrow(/sheets/);
  });

  it('records unread sheet keys as exclusions instead of dropping them', () => {
    const widened = withSheet(
      'overrides',
      '@layer anm-overrides{.animus-Alert-a385f997{color:red !important}}'
    );

    const exclusions = createAnimusHost(widened)
      .universe.universe()
      .exclusions.join('\n');

    expect(exclusions).toMatch(/sheet 'overrides'/);
    // The build's own `declaration` sheet (the `@layer` precedence statement)
    // is likewise never read, and that must be said, not implied away.
    expect(exclusions).toMatch(/sheet 'declaration'/);
  });
});
