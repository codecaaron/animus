import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { createPlaceAnalysis, loadSnapshot } from '../src/places';

import type { Observation, PlaceAnalysis, Snapshot } from '../src/places';

const FIXTURE = join(__dirname, 'fixtures/rollup-app');
const SOURCE_ROOT = join(__dirname, '../../../e2e/rollup-app');
const GROUP_FILE = 'src/Group.tsx';

const GROUP_ITEM_CLASS = 'animus-GroupItem-32b2d32f';
const KIT_BUTTON_ID =
  '../../packages/test-ds/src/components/Button.tsx::Button';
const KIT_BUTTON_CLASS = 'animus-Button-c63b6dcd';
const KIT_BUTTON_VARIANT_DIMENSION = `variant:${KIT_BUTTON_ID}:variant`;

const ACTIVE_AXIS = 'ancestor:[data-active=true]';
const HOVER_AXIS = 'ancestor:.group:hover';

const snapshot: Snapshot = loadSnapshot(FIXTURE, { sourceRoot: SOURCE_ROOT });
const analysis: PlaceAnalysis = createPlaceAnalysis(snapshot);

const sourceText = readFileSync(join(SOURCE_ROOT, GROUP_FILE), 'utf8');

const invocationAt = (marker: string) => {
  const offset = sourceText.indexOf(marker);
  expect(offset).toBeGreaterThan(0);
  const invocation = analysis.at(GROUP_FILE, offset);
  expect(invocation).toBeDefined();
  if (invocation === undefined) throw new Error('unreachable');
  return invocation;
};

const candidateAt = (
  result: ReturnType<PlaceAnalysis['locate']>,
  marker: string
) => {
  const invocation = invocationAt(marker);
  const match = result.matches.find(
    (entry) => entry.component.className === GROUP_ITEM_CLASS
  );
  expect(match).toBeDefined();
  const candidate = match?.candidates.find(
    (entry) =>
      entry.place.invocation.file === invocation.file &&
      entry.place.invocation.ordinal === invocation.ordinal
  );
  expect(candidate).toBeDefined();
  if (candidate === undefined) throw new Error('unreachable');
  return candidate;
};

describe('locate — the observation-first entry (PLACES.md §5)', () => {
  it('narrows the candidate places from an observed active wrapper', () => {
    const result = analysis.locate({
      source: 'dom',
      subject: { classes: ['app-shell', GROUP_ITEM_CLASS] },
      ancestors: [
        {
          tag: 'div',
          classes: ['group'],
          attributes: { 'data-active': 'true' },
        },
      ],
    });

    expect(candidateAt(result, 'active kit item').verdict).toBe('consistent');
    const inactive = candidateAt(result, 'inactive kit item');
    expect(inactive.verdict).toBe('conditional');
    expect(inactive.notes.join('\n')).toMatch(/JSX root|scoped/);
    expect(candidateAt(result, 'framed kit item').verdict).toBe('consistent');
    const dynamic = candidateAt(result, 'conditional kit item');
    expect(dynamic.verdict).toBe('conditional');
    expect(dynamic.notes.join('\n')).toMatch(/group:hover/);
    expect(dynamic.notes.join('\n')).not.toMatch(/data-active/);

    expect(result.unmatchedClasses).toEqual(['app-shell']);
  });

  it('contradicts the established place when a complete chain lacks it', () => {
    const result = analysis.locate({
      source: 'dom',
      subject: { classes: [GROUP_ITEM_CLASS] },
      ancestors: [
        { tag: 'div', classes: [], attributes: {} },
        { tag: 'body', classes: [], attributes: {} },
        { tag: 'html', classes: [], attributes: {} },
      ],
      completeToRoot: true,
    });

    const active = candidateAt(result, 'active kit item');
    expect(active.verdict).toBe('contradicted');
    expect(active.notes.join('\n')).toMatch(/data-active/);
    expect(candidateAt(result, 'inactive kit item').verdict).toBe('consistent');
  });

  it('reports meaningless classes honestly: no match, nothing invented', () => {
    const result = analysis.locate({
      source: 'classes',
      subject: { classes: ['not-an-animus-class'] },
    });
    expect(result.matches).toEqual([]);
    expect(result.unmatchedClasses).toEqual(['not-an-animus-class']);
  });

  it('identifies a component by emitted class where bindings collide', () => {
    // Two `Button` bindings exist in this snapshot, so bare-name resolution
    // refuses; the observed class names exactly one of them.
    expect(snapshot.host.identity.resolveTarget('Button')).toBeUndefined();

    const result = analysis.locate({
      source: 'dom',
      subject: {
        classes: [KIT_BUTTON_CLASS, `${KIT_BUTTON_CLASS}--variant-primary`],
      },
    });

    const match = result.matches.find(
      (entry) => entry.component.id === KIT_BUTTON_ID
    );
    expect(match).toBeDefined();
    expect(match?.impliedPoint).toMatchObject({
      [KIT_BUTTON_VARIANT_DIMENSION]: 'primary',
    });
    expect(match?.conflicts).toEqual([]);
  });

  it('turns an impossible class pair into a conflict, not a binding', () => {
    const result = analysis.locate({
      source: 'classes',
      subject: {
        classes: [
          KIT_BUTTON_CLASS,
          `${KIT_BUTTON_CLASS}--variant-primary`,
          `${KIT_BUTTON_CLASS}--variant-ghost`,
        ],
      },
    });

    const match = result.matches.find(
      (entry) => entry.component.id === KIT_BUTTON_ID
    );
    expect(match).toBeDefined();
    expect(match?.conflicts.length).toBeGreaterThan(0);
    expect(match?.impliedPoint).not.toHaveProperty(
      KIT_BUTTON_VARIANT_DIMENSION
    );
  });

  it('implies the mode coordinate from an observed data-color-mode root', () => {
    const result = analysis.locate({
      source: 'dom',
      subject: { classes: [GROUP_ITEM_CLASS] },
      ancestors: [
        { tag: 'html', classes: [], attributes: { 'data-color-mode': 'dark' } },
      ],
    });
    const match = result.matches.find(
      (entry) => entry.component.className === GROUP_ITEM_CLASS
    );
    expect(match?.impliedPoint).toMatchObject({ mode: 'dark' });
  });

  it('rejects an undeclared mode value instead of fabricating one', () => {
    const result = analysis.locate({
      source: 'dom',
      subject: { classes: [GROUP_ITEM_CLASS] },
      ancestors: [
        {
          tag: 'html',
          classes: [],
          attributes: { 'data-color-mode': 'sepia' },
        },
      ],
    });
    const match = result.matches.find(
      (entry) => entry.component.className === GROUP_ITEM_CLASS
    );
    expect(match?.impliedPoint).not.toHaveProperty('mode');
    expect(match?.conflicts.join('\n')).toMatch(/sepia/);
  });
});

describe('observe — discharging open axes with evidence (PLACES.md §5)', () => {
  const framedPlace = () => analysis.placeOf(invocationAt('framed kit item'));

  it('establishes the hidden axis behind the opaque Frame from an SSR chain', () => {
    const place = framedPlace();
    expect(place.bindings).toContainEqual(
      expect.objectContaining({
        axis: ACTIVE_AXIS,
        state: 'open',
        reason: 'opaque-component',
      })
    );

    const observation: Observation = {
      source: 'ssr',
      ancestors: [
        {
          tag: 'section',
          classes: ['frame'],
          attributes: { 'data-active': 'true' },
        },
        { tag: 'div', classes: [], attributes: {} },
      ],
      completeToRoot: true,
    };
    const observed = analysis.observe(place, observation);

    expect(observed.contradictions).toEqual([]);
    expect(observed.place.bindings).toContainEqual(
      expect.objectContaining({
        axis: ACTIVE_AXIS,
        state: 'established',
        evidence: expect.objectContaining({ source: 'ssr' }),
      })
    );
    // The complete chain carries no `.group`, so the stateful axis is refuted:
    // hover cannot fire without its structural half.
    expect(observed.place.bindings).toContainEqual(
      expect.objectContaining({
        axis: HOVER_AXIS,
        state: 'refuted',
        evidence: expect.objectContaining({ source: 'ssr' }),
      })
    );
    expect(observed.discharged.map((binding) => binding.axis).sort()).toEqual([
      HOVER_AXIS,
      ACTIVE_AXIS,
    ]);
    expect(observed.place.assumptions.join('\n')).toMatch(/observ/i);

    const before = analysis.explain(place, {
      property: 'color',
      at: { mode: 'light' },
    });
    expect(before.winner?.selector).toBe(`.${GROUP_ITEM_CLASS}`);
    const after = analysis.explain(observed.place, {
      property: 'color',
      at: { mode: 'light' },
    });
    expect(after.winner?.selector).toBe(
      `[data-active="true"] .${GROUP_ITEM_CLASS}`
    );
  });

  it('refutes only from a complete chain; an incomplete one stays open', () => {
    const chain = [
      { tag: 'section', classes: ['frame'], attributes: {} },
      { tag: 'div', classes: [], attributes: {} },
    ];

    const incomplete = analysis.observe(framedPlace(), {
      source: 'ssr',
      ancestors: chain,
    });
    expect(incomplete.place.bindings).toContainEqual(
      expect.objectContaining({ axis: ACTIVE_AXIS, state: 'open' })
    );
    expect(incomplete.discharged).toEqual([]);

    const complete = analysis.observe(framedPlace(), {
      source: 'ssr',
      ancestors: chain,
      completeToRoot: true,
    });
    expect(complete.place.bindings).toContainEqual(
      expect.objectContaining({
        axis: ACTIVE_AXIS,
        state: 'refuted',
        evidence: expect.objectContaining({ source: 'ssr' }),
      })
    );
    expect(complete.place.assumptions.join('\n')).toMatch(/observed chain/);
  });

  it('surfaces a contradiction and discharges nothing — never averages', () => {
    const place = analysis.placeOf(invocationAt('active kit item'));
    const observed = analysis.observe(place, {
      source: 'dom',
      ancestors: [
        { tag: 'div', classes: [], attributes: {} },
        { tag: 'body', classes: [], attributes: {} },
      ],
      completeToRoot: true,
    });

    expect(observed.contradictions.length).toBeGreaterThan(0);
    expect(observed.contradictions.join('\n')).toMatch(/data-active/);
    expect(observed.discharged).toEqual([]);
    expect(observed.place.bindings).toEqual(place.bindings);
  });

  it('lets an observation discharge a scoped refutation beyond the file', () => {
    const place = analysis.placeOf(invocationAt('inactive kit item'));
    const observed = analysis.observe(place, {
      source: 'dom',
      ancestors: [
        { tag: 'div', classes: [], attributes: { 'data-active': 'false' } },
        { tag: 'main', classes: [], attributes: { 'data-active': 'true' } },
      ],
      completeToRoot: true,
    });

    expect(observed.contradictions).toEqual([]);
    expect(observed.place.bindings).toContainEqual(
      expect.objectContaining({
        axis: ACTIVE_AXIS,
        state: 'established',
        evidence: expect.objectContaining({ source: 'dom' }),
      })
    );
    expect(observed.place.assumptions.join('\n')).toMatch(/assumption/);
  });

  it('never establishes a stateful axis from a snapshot observation', () => {
    // The observed `.group` satisfies the structural half of `.group:hover`;
    // a DOM snapshot cannot witness hover, so the axis stays open.
    const observed = analysis.observe(framedPlace(), {
      source: 'dom',
      ancestors: [
        { tag: 'section', classes: ['group', 'frame'], attributes: {} },
      ],
      completeToRoot: true,
    });
    expect(observed.place.bindings).toContainEqual(
      expect.objectContaining({
        axis: HOVER_AXIS,
        state: 'open',
        reason: 'stateful-pseudo',
      })
    );
  });

  it('leaves an axis open when the observation cannot see enough', () => {
    // An element with no attribute map is unknown, not absent: it can neither
    // satisfy nor exclude the requirement, so the axis stays open.
    const observed = analysis.observe(framedPlace(), {
      source: 'dom',
      ancestors: [{ tag: 'section' }],
      completeToRoot: true,
    });
    expect(observed.place.bindings).toContainEqual(
      expect.objectContaining({ axis: ACTIVE_AXIS, state: 'open' })
    );
    expect(observed.discharged).toEqual([]);
  });
});
