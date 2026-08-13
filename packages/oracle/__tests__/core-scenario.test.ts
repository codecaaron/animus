import { describe, expect, it } from 'vitest';

import {
  and,
  eq,
  evalPredicate,
  inSet,
  not,
  or,
  range,
} from '../src/core/predicate';
import { countCells, enumerateCells } from '../src/core/scenario';

import type { Predicate } from '../src/core/predicate';
import type { ScenarioDomain } from '../src/core/scenario';

const viewport = (min: number, max: number): ScenarioDomain => ({
  x: { kind: 'interval', min, max },
});

const reps = (domain: ScenarioDomain, cuts: Record<string, number[]>) =>
  enumerateCells(domain, cuts).map((cell) => cell.point.x);

describe('enumerateCells — interval partitioning', () => {
  it('alternates flanking intervals, cut singletons and open gaps', () => {
    const cells = enumerateCells(viewport(0, 1920), { x: [768, 1024] });

    expect(cells.map((cell) => cell.point.x)).toEqual([
      384, // [0, 768)
      768, // {768}
      896, // (768, 1024)
      1024, // {1024}
      1472, // (1024, 1920]
    ]);
    expect(cells.map((cell) => cell.description.x)).toEqual([
      '0 ≤ x < 768',
      'x = 768',
      '768 < x < 1024',
      'x = 1024',
      '1024 < x ≤ 1920',
    ]);
  });

  it('shrinks the low flank away when a cut sits on min', () => {
    expect(reps(viewport(0, 1920), { x: [0, 768] })).toEqual([
      0, 384, 768, 1344,
    ]);
  });

  it('shrinks the high flank away when a cut sits on max', () => {
    expect(reps(viewport(0, 1920), { x: [768, 1920] })).toEqual([
      384, 768, 1344, 1920,
    ]);
  });

  it('is one closed cell when there are no cuts', () => {
    const cells = enumerateCells(viewport(0, 1920), {});
    expect(cells).toHaveLength(1);
    expect(cells[0].point.x).toBe(960);
    expect(cells[0].description.x).toBe('0 ≤ x ≤ 1920');
  });

  it('collapses a degenerate min === max interval to one singleton', () => {
    const cells = enumerateCells(viewport(600, 600), { x: [600] });
    expect(cells).toHaveLength(1);
    expect(cells[0].point.x).toBe(600);
    expect(cells[0].description.x).toBe('x = 600');
  });

  it('ignores out-of-range cuts and normalises order and duplicates', () => {
    expect(reps(viewport(0, 100), { x: [-50, 200] })).toEqual([50]);
    expect(reps(viewport(0, 100), { x: [50, 50, 25] })).toEqual(
      reps(viewport(0, 100), { x: [25, 50] })
    );
  });

  it('rejects intervals that cannot be partitioned', () => {
    expect(() => enumerateCells(viewport(10, 1), {})).toThrow(/empty interval/);
    expect(() =>
      enumerateCells(viewport(0, Number.POSITIVE_INFINITY), {})
    ).toThrow(/finite/);
  });
});

describe('enumerateCells — product structure', () => {
  const domain: ScenarioDomain = {
    ...viewport(0, 1920),
    mode: { kind: 'finite', values: ['light', 'dark'] },
  };
  const cuts = { x: [768] };

  it('is the cartesian product of the per-dimension partitions', () => {
    const cells = enumerateCells(domain, cuts);
    expect(cells).toHaveLength(3 * 2);
    // Dimensions are visited in sorted name order; the last one varies fastest.
    expect(cells.map((cell) => [cell.point.mode, cell.point.x])).toEqual([
      ['light', 384],
      ['light', 768],
      ['light', 1344],
      ['dark', 384],
      ['dark', 768],
      ['dark', 1344],
    ]);
  });

  it('describes every dimension of every cell', () => {
    for (const cell of enumerateCells(domain, cuts)) {
      expect(Object.keys(cell.description).sort()).toEqual(['mode', 'x']);
      expect(cell.description.mode).toMatch(/^mode = (light|dark)$/);
    }
  });

  it('yields the single empty cell for an empty domain', () => {
    expect(enumerateCells({}, {})).toEqual([{ point: {}, description: {} }]);
  });
});

describe('countCells', () => {
  const cases: { domain: ScenarioDomain; cuts: Record<string, number[]> }[] = [
    { domain: viewport(0, 1920), cuts: { x: [768, 1024] } },
    { domain: viewport(0, 1920), cuts: { x: [0, 768] } },
    { domain: viewport(0, 1920), cuts: { x: [768, 1920] } },
    { domain: viewport(0, 1920), cuts: { x: [0, 1920] } },
    { domain: viewport(0, 1920), cuts: {} },
    { domain: viewport(600, 600), cuts: { x: [600] } },
    { domain: viewport(0, 100), cuts: { x: [-1, 500] } },
    {
      domain: {
        ...viewport(0, 1920),
        mode: { kind: 'finite', values: ['light', 'dark'] },
        'state:Box:hover': { kind: 'finite', values: [true, false] },
      },
      cuts: { x: [768, 1024] },
    },
    { domain: {}, cuts: {} },
    { domain: { mode: { kind: 'finite', values: [] } }, cuts: {} },
  ];

  it('agrees with enumerateCells without materialising it', () => {
    for (const { domain, cuts } of cases) {
      expect(countCells(domain, cuts)).toBe(
        enumerateCells(domain, cuts).length
      );
    }
  });
});

/**
 * The soundness core: a predicate whose thresholds are all in `cuts` must be
 * constant on every cell, which is what makes evaluating one representative a
 * proof over the whole cell.
 */
describe('cell invariant', () => {
  const min = 0;
  const max = 16;
  const cuts = [4, 8, 12];

  interface ExpectedCell {
    rep: number;
    contains: (v: number) => boolean;
  }

  // Independently reconstructed partition — deliberately NOT built from
  // enumerateCells, so a bug in the partition cannot agree with itself.
  const expectedCells: ExpectedCell[] = [
    { rep: 2, contains: (v) => v >= 0 && v < 4 },
    { rep: 4, contains: (v) => v === 4 },
    { rep: 6, contains: (v) => v > 4 && v < 8 },
    { rep: 8, contains: (v) => v === 8 },
    { rep: 10, contains: (v) => v > 8 && v < 12 },
    { rep: 12, contains: (v) => v === 12 },
    { rep: 14, contains: (v) => v > 12 && v <= 16 },
  ];

  // Exact binary fractions only — no floating-point slack in the sweep.
  const sweep: number[] = [];
  for (let v = min; v <= max; v += 0.25) sweep.push(v);

  const constantOnEveryCell = (p: Predicate): boolean =>
    expectedCells.every((cell) => {
      const atRep = evalPredicate(p, { x: cell.rep });
      return sweep
        .filter((v) => cell.contains(v))
        .every((v) => evalPredicate(p, { x: v }) === atRep);
    });

  it('reproduces the partition enumerateCells produces', () => {
    expect(reps({ x: { kind: 'interval', min, max } }, { x: cuts })).toEqual(
      expectedCells.map((cell) => cell.rep)
    );
  });

  it('holds for every predicate whose thresholds are all cuts', () => {
    const covered: Predicate[] = [
      range('x', { min: 8 }),
      range('x', { max: 8 }),
      range('x', { max: 8, maxInclusive: false }),
      range('x', { min: 4, minInclusive: false, max: 12 }),
      range('x', { min: 0, max: 16 }),
      eq('x', 8),
      inSet('x', [4, 12]),
      not(range('x', { min: 12 })),
      and(range('x', { min: 4 }), not(range('x', { min: 12 }))),
      or(range('x', { max: 4 }), eq('x', 12)),
    ];

    for (const p of covered) {
      expect(constantOnEveryCell(p)).toBe(true);
    }
  });

  it('fails for a threshold outside the cuts — the gate is not vacuous', () => {
    expect(constantOnEveryCell(range('x', { min: 5 }))).toBe(false);
    expect(constantOnEveryCell(eq('x', 5))).toBe(false);
  });
});
