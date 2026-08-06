/**
 * Characterization tests for renderScoreboard.
 *
 * The scoreboard is a committed, diffable text artifact (scoreboard.snap,
 * self-check.snap) that `verify:parity` compares byte-for-byte. Until now the
 * renderer had no unit coverage at all — only `familyViolations` was tested —
 * so every structural change to it was licensed solely by a medium-cost parity
 * run that needs a freshly built NAPI.
 *
 * These tests pin the exact rendered bytes across every branch of the renderer
 * (empty corpus, registered vs unregistered divergences, CSS classification,
 * both family verdicts, and appended family-verdict errors) so that a
 * structural refactor is provably output-preserving in milliseconds.
 */
import { describe, expect, test } from 'vitest';

import { renderScoreboard } from '../src/scoreboard';

import type { Divergence, FamilyDecl } from '../src/types';

function divergence(overrides: Partial<Divergence> = {}): Divergence {
  return {
    unit: 'unit-a',
    artifact: 'css',
    detail: 'css differs',
    baselineSha256: 'aaa111',
    candidateSha256: 'bbb222',
    ...overrides,
  };
}

const BASE = {
  mode: 'baseline',
  engines: ['baseline:v2', 'v2'] as [string, string],
  devMode: false,
  unitIds: [] as string[],
  divergences: [] as Divergence[],
  families: [] as FamilyDecl[],
  familyVerdictErrors: [] as string[],
};

describe('renderScoreboard', () => {
  test('empty corpus reports 100% rather than dividing by zero', () => {
    expect(renderScoreboard(BASE)).toBe(
      [
        'parity baseline — engines: baseline:v2 vs v2 — devMode: false',
        '',
        'Units passed: 0/0 (100.00%)',
        'Divergences: 0 (0 unregistered)',
        '',
        'Usage-case families:',
        '',
      ].join('\n')
    );
  });

  test('all-passing run matches the committed snapshot header shape', () => {
    const out = renderScoreboard({
      ...BASE,
      unitIds: ['unit-a', 'unit-b'],
      families: [
        { family: 'fam-1', units: ['unit-a'], expectedVerdict: 'identical' },
      ],
    });

    expect(out).toBe(
      [
        'parity baseline — engines: baseline:v2 vs v2 — devMode: false',
        '',
        'Units passed: 2/2 (100.00%)',
        'Divergences: 0 (0 unregistered)',
        '',
        'Usage-case families:',
        '  ok fam-1 — expected identical, observed identical',
        '',
      ].join('\n')
    );
  });

  test('unregistered divergence renders hashes, marker, and violated family', () => {
    const out = renderScoreboard({
      ...BASE,
      unitIds: ['unit-a', 'unit-b'],
      divergences: [divergence()],
      families: [
        {
          family: 'fam-1',
          units: ['unit-a'],
          expectedVerdict: 'identical',
        },
      ],
    });

    expect(out).toBe(
      [
        'parity baseline — engines: baseline:v2 vs v2 — devMode: false',
        '',
        'Units passed: 1/2 (50.00%)',
        'Divergences: 1 (1 unregistered)',
        '',
        'Failing units (sorted):',
        '  unit-a · css (UNREGISTERED) [aaa111 -> bbb222] — css differs',
        '',
        'Usage-case families:',
        '  VIOLATED fam-1 — expected identical, observed divergence',
        '',
      ].join('\n')
    );
  });

  test('registered divergence renders its category and satisfies the family', () => {
    const out = renderScoreboard({
      ...BASE,
      unitIds: ['unit-a'],
      divergences: [
        divergence({
          classification: 'rule-order',
          registered: {
            unit: 'unit-a',
            artifact: 'css',
            category: 'ordering',
            note: 'known',
            status: 'active',
            baselineSha256: 'aaa111',
            candidateSha256: 'bbb222',
          },
        }),
      ],
      families: [
        {
          family: 'fam-1',
          units: ['unit-a'],
          expectedVerdict: 'registered-divergence',
        },
      ],
    });

    expect(out).toBe(
      [
        'parity baseline — engines: baseline:v2 vs v2 — devMode: false',
        '',
        'Units passed: 0/1 (0.00%)',
        'Divergences: 1 (0 unregistered)',
        '',
        'Failing units (sorted):',
        '  unit-a · css [rule-order] (registered: ordering) [aaa111 -> bbb222] — css differs',
        '',
        'Usage-case families:',
        '  ok fam-1 — expected registered-divergence, observed divergence',
        '',
      ].join('\n')
    );
  });

  test('failing units are sorted and grouped by unit', () => {
    const out = renderScoreboard({
      ...BASE,
      unitIds: ['unit-a', 'unit-b', 'unit-c'],
      divergences: [
        divergence({
          unit: 'unit-c',
          artifact: 'code',
          detail: 'code differs',
        }),
        divergence({ unit: 'unit-a', artifact: 'css', detail: 'first' }),
        divergence({
          unit: 'unit-a',
          artifact: 'diagnostics',
          detail: 'second',
        }),
      ],
    });

    const failing = out
      .split('\n')
      .filter((l) => l.startsWith('  unit-'))
      .map((l) => l.split(' · ')[1]);

    expect(failing).toEqual([
      'css (UNREGISTERED) [aaa111 -> bbb222] — first',
      'diagnostics (UNREGISTERED) [aaa111 -> bbb222] — second',
      'code (UNREGISTERED) [aaa111 -> bbb222] — code differs',
    ]);
  });

  test('family verdict errors are appended after the family list', () => {
    const out = renderScoreboard({
      ...BASE,
      unitIds: ['unit-a'],
      families: [
        { family: 'fam-1', units: ['unit-a'], expectedVerdict: 'identical' },
      ],
      familyVerdictErrors: ['fam-2: expected registered divergence, saw none'],
    });

    expect(out.split('\n').slice(-3)).toEqual([
      '  ok fam-1 — expected identical, observed identical',
      '  VIOLATED fam-2: expected registered divergence, saw none',
      '',
    ]);
  });

  test('self-check mode and devMode are reflected in the header', () => {
    const out = renderScoreboard({
      ...BASE,
      mode: 'self-check',
      engines: ['v2', 'v2'],
      devMode: true,
    });

    expect(out.split('\n')[0]).toBe(
      'parity self-check — engines: v2 vs v2 — devMode: true'
    );
  });
});
