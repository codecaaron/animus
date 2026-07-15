import { describe, expect, test } from 'bun:test';

import { measureFloorCss } from './floor-css-measurement';

describe('floor CSS measurement', () => {
  test('reports deterministic before/after deltas from manifest-only fields', () => {
    const baseline = {
      capturedAt: 'before',
      engine: 'v2',
      consumers: {
        vite: { cssBytes: 80, systemBytes: 10, dynamicProps: 1 },
        next: { cssBytes: 100, systemBytes: 20, dynamicProps: 0 },
      },
    };
    const after = {
      vite: {
        css: 'x'.repeat(60),
        sheets: { system: 's'.repeat(5), custom: 'ignored' },
        dynamic_props: { p: {} },
        usageResidue: 'ignored',
      },
      next: {
        css: 'x'.repeat(125),
        sheets: { system: 's'.repeat(25) },
        dynamicProps: { p: {}, m: {} },
        components: 'ignored',
      },
    };

    after.vite.css = 'é'.repeat(30);
    after.vite.sheets.system = 'é'.repeat(2) + 's';

    expect(measureFloorCss(baseline, after)).toEqual({
      baselineCapturedAt: 'before',
      engine: 'v2',
      consumers: {
        next: {
          cssBytes: { before: 100, after: 125, delta: 25, percent: 25 },
          systemBytes: { before: 20, after: 25, delta: 5, percent: 25 },
          dynamicProps: { before: 0, after: 2, delta: 2, percent: null },
        },
        vite: {
          cssBytes: { before: 80, after: 60, delta: -20, percent: -25 },
          systemBytes: { before: 10, after: 5, delta: -5, percent: -50 },
          dynamicProps: { before: 1, after: 1, delta: 0, percent: 0 },
        },
      },
    });
  });
});
