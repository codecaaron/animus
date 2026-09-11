import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { createPlaceAnalysis, loadSnapshot } from '../src/places';

import type { PlaceAnalysis, Snapshot } from '../src/places';

const FIXTURE = join(__dirname, 'fixtures/rollup-app');
const SOURCE_ROOT = join(__dirname, '../../../e2e/rollup-app');
const GROUP_FILE = 'src/Group.tsx';

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

describe('snapshot correspondence (mixed-generation prevention)', () => {
  it('verifies the committed source against the committed artifacts', () => {
    const structure = snapshot.structureOf(GROUP_FILE);
    expect(structure.ok).toBe(true);
  });

  it('refuses a file that was never part of this snapshot', () => {
    const result = snapshot.structureOf('src/App.tsx');
    expect(result).toMatchObject({ ok: false, reason: 'not-in-snapshot' });
  });

  it('refuses a file that drifted since extraction, naming the divergence', () => {
    const drifted = mkdtempSync(join(tmpdir(), 'places-drift-'));
    mkdirSync(join(drifted, 'src'), { recursive: true });
    // Replace the whole opening tag: the bare attribute text also appears in
    // the source file's comments, and a comment edit is not structural drift.
    const edited = sourceText.replace(
      '<div className="group" data-active="true">',
      '<div className="group" data-active="maybe">'
    );
    expect(edited).not.toBe(sourceText);
    writeFileSync(join(drifted, GROUP_FILE), edited);

    const other = loadSnapshot(FIXTURE, { sourceRoot: drifted });
    const result = other.structureOf(GROUP_FILE);
    expect(result).toMatchObject({ ok: false, reason: 'diverged' });
    if (result.ok === false) {
      expect(result.divergences?.join('\n')).toMatch(/data-active/);
    }
  });
});

describe('invocations and places', () => {
  it('finds every real GroupItem invocation in the snapshot', () => {
    const invocations = analysis.invocationsOf('GroupItem');
    expect(invocations).toHaveLength(4);
    expect(new Set(invocations.map((ref) => ref.file))).toEqual(
      new Set([GROUP_FILE])
    );
  });

  it('resolves file+offset to the innermost component invocation', () => {
    const framed = invocationAt('framed kit item');
    expect(framed.component.binding).toBe('GroupItem');
  });

  it('establishes the ancestor axis at the active place, with a witness', () => {
    const place = analysis.placeOf(invocationAt('active kit item'));

    expect(place.bindings).toContainEqual(
      expect.objectContaining({
        axis: ACTIVE_AXIS,
        state: 'established',
        witness: expect.objectContaining({ tag: 'div' }),
      })
    );
    // The wrapper carries className="group", so the hover axis is structurally
    // present, yet a stateful pseudo is never established from structure.
    expect(place.bindings).toContainEqual(
      expect.objectContaining({
        axis: HOVER_AXIS,
        state: 'open',
        reason: 'stateful-pseudo',
      })
    );
  });

  it('refutes both axes at the inactive place, scoped by an assumption', () => {
    const place = analysis.placeOf(invocationAt('inactive kit item'));

    for (const axis of [ACTIVE_AXIS, HOVER_AXIS]) {
      expect(place.bindings).toContainEqual(
        expect.objectContaining({ axis, state: 'refuted' })
      );
    }
    expect(place.assumptions.join('\n')).toMatch(/JSX root/);
  });

  it('degrades honestly behind the opaque wrapper', () => {
    const place = analysis.placeOf(invocationAt('framed kit item'));

    expect(place.bindings).toContainEqual(
      expect.objectContaining({
        axis: ACTIVE_AXIS,
        state: 'open',
        reason: 'opaque-component',
        witness: expect.objectContaining({ tag: 'Frame' }),
      })
    );
  });

  it('leaves a dynamic ancestor attribute open with its reason', () => {
    const place = analysis.placeOf(invocationAt('conditional kit item'));

    expect(place.bindings).toContainEqual(
      expect.objectContaining({
        axis: ACTIVE_AXIS,
        state: 'open',
        reason: 'dynamic-attribute',
      })
    );
  });
});

describe('the gray-on-blue explanation (PLACES.md §4)', () => {
  const activePlace = () => analysis.placeOf(invocationAt('active kit item'));

  it('explains why color goes muted at active ∧ dark: order, same layer', () => {
    const explanation = analysis.explain(activePlace(), {
      property: 'color',
      at: { mode: 'dark' },
    });

    expect(explanation.winner?.selector).toBe(
      '[data-color-mode="dark"] .animus-GroupItem-32b2d32f'
    );
    expect(explanation.winner?.value).toBe('var(--color-text-muted)');
    expect(explanation.winner?.layer).toBe('anm-base');
    expect(explanation.defeated).toContainEqual(
      expect.objectContaining({
        selector: '[data-active="true"] .animus-GroupItem-32b2d32f',
        value: 'var(--color-background)',
        reason: 'earlier-order',
      })
    );
    expect(explanation.requiredAncestors).toContainEqual(
      expect.objectContaining({ axis: ACTIVE_AXIS, state: 'established' })
    );
  });

  it('keeps the blue background while the text goes muted — the symptom', () => {
    const explanation = analysis.explain(activePlace(), {
      property: 'background-color',
      at: { mode: 'dark' },
    });
    expect(explanation.winner?.value).toBe('var(--color-primary)');
  });

  it('gives the active rule the win at light mode — mode-guarded, not global', () => {
    const explanation = analysis.explain(activePlace(), {
      property: 'color',
      at: { mode: 'light' },
    });
    expect(explanation.winner?.selector).toBe(
      '[data-active="true"] .animus-GroupItem-32b2d32f'
    );
  });
});

describe('carrying a candidate repair across places (charter step 4)', () => {
  const darkRule = snapshot.host.universe
    .universe()
    .rules.find(
      (rule) =>
        rule.selector.raw ===
        '[data-color-mode="dark"] .animus-GroupItem-32b2d32f'
    );

  it('partitions outcomes into changed / stable / ambiguous / inaccessible', () => {
    expect(darkRule).toBeDefined();
    if (darkRule === undefined) return;

    const outcomes = analysis.carry(
      [{ kind: 'remove-declaration', rule: darkRule.id, property: 'color' }],
      { component: 'GroupItem', property: 'color' }
    );

    const at = (marker: string, mode: string) => {
      const invocation = invocationAt(marker);
      const row = outcomes.find(
        (outcome) =>
          outcome.place.invocation.ordinal === invocation.ordinal &&
          outcome.context.mode === mode
      );
      expect(row).toBeDefined();
      return row;
    };

    // Carried values are token-resolved: an outcome reports the computed
    // colour, not the var() indirection.
    expect(at('active kit item', 'dark')).toMatchObject({
      outcome: 'changed',
      from: '#737373',
      to: '#171717',
    });
    expect(at('inactive kit item', 'dark')?.outcome).toBe('changed');
    expect(at('active kit item', 'light')?.outcome).toBe('stable');
    expect(at('inactive kit item', 'light')?.outcome).toBe('stable');
    expect(at('framed kit item', 'dark')?.outcome).toBe('inaccessible');
    expect(at('framed kit item', 'light')?.outcome).toBe('inaccessible');
    expect(at('conditional kit item', 'dark')?.outcome).toBe('ambiguous');
  });
});
