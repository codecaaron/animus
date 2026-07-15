import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, test } from 'vitest';

import {
  assertRefreshEligible,
  assertRefreshIntent,
  assertRefreshPairEligible,
  baselineGateFailed,
  compareUnitSets,
  createBaselineEnvelope,
  refreshFamilyErrors,
  refreshPairFamilyErrors,
  validateBaselineEnvelope,
  writeBaselinePairAtomic,
  writeValidatedBaselinePair,
} from '../src/baseline';

import type { BaselineMode, BaselineRefreshChecks } from '../src/baseline';
import type { RegisterEntry, UnitSurface } from '../src/types';

function surface(css = '.a{color:red}'): UnitSurface {
  return {
    css,
    code: { 'a.tsx': 'export const x = 1' },
    hasComponents: { 'a.tsx': true },
    diagnostics: [],
    observables: {
      componentFragmentKeys: [],
      reverseProvenanceEdges: [],
      systemPropMapJson: '{}',
      dynamicPropsJson: '{}',
      sheetsJson: '{}',
      componentFragmentsJson: '{}',
    },
    parseCount: 1,
  };
}

describe('committed v2 baseline comparison', () => {
  test('detects changed content with exact hashes', async () => {
    const divs = await compareUnitSets(
      { unit: surface() },
      { unit: surface('.a{color:blue}') }
    );

    expect(divs.some((d) => d.unit === 'unit' && d.artifact === 'css')).toBe(
      true
    );
    expect(divs.every((d) => /^[a-f0-9]{64}$/.test(d.baselineSha256))).toBe(
      true
    );
    expect(divs.every((d) => /^[a-f0-9]{64}$/.test(d.candidateSha256))).toBe(
      true
    );
  });

  test('detects parse-count drift within the allowed budget', async () => {
    const candidate = surface();
    candidate.parseCount = 2;
    const divs = await compareUnitSets(
      { unit: surface() },
      { unit: candidate }
    );

    expect(divs).toEqual([
      expect.objectContaining({
        unit: 'unit',
        artifact: 'observables',
        detail: 'parseCount differs',
      }),
    ]);
    expect(divs[0]?.baselineSha256).not.toBe(divs[0]?.candidateSha256);
  });

  test('detects baseline-only and candidate-only units', async () => {
    const missing = await compareUnitSets(
      { retained: surface(), removed: surface() },
      { retained: surface(), added: surface() }
    );

    for (const unit of ['added', 'removed']) {
      expect(
        missing
          .filter((d) => d.unit === unit)
          .map((d) => d.artifact)
          .sort()
      ).toEqual(['code', 'css', 'diagnostics', 'observables']);
    }
  });

  test('a licensed stale baseline still fails the ordinary gate', async () => {
    const divs = await compareUnitSets(
      { unit: surface() },
      { unit: surface('.a{color:blue}') }
    );
    const exact = divs.map(
      (d): RegisterEntry => ({
        unit: d.unit,
        artifact: d.artifact,
        category: 'intentional-correctness',
        note: 'intentional test drift',
        status: 'active',
        baselineSha256: d.baselineSha256,
        candidateSha256: d.candidateSha256,
      })
    );

    expect(() => assertRefreshEligible(divs, exact)).not.toThrow();
    expect(baselineGateFailed(divs, [])).toBe(true);
  });
});

describe('baseline envelope and refresh protocol', () => {
  test('validates version, mode, schema, and corpus digest', () => {
    const envelope = createBaselineEnvelope(
      'production',
      'seed-2026-07-13',
      'c'.repeat(64),
      { unit: surface() }
    );

    expect(
      validateBaselineEnvelope(envelope, {
        mode: 'production',
        corpusSha256: 'c'.repeat(64),
      })
    ).toEqual([]);
    expect(
      validateBaselineEnvelope(envelope, {
        mode: 'development',
        corpusSha256: 'd'.repeat(64),
      })
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining('mode'),
        expect.stringContaining('corpus'),
      ])
    );
  });

  test('requires an exact checked journal intent', () => {
    const journal = [
      '# Baseline refresh journal',
      '- [ ] `not-approved` — draft',
      '- [x] `approved-01` — intentional CSS update',
    ].join('\n');

    expect(() => assertRefreshIntent('approved-01', journal)).not.toThrow();
    expect(() => assertRefreshIntent('not-approved', journal)).toThrow(
      /checked journal intent/
    );
    expect(() => assertRefreshIntent('missing', journal)).toThrow(
      /checked journal intent/
    );
  });

  test('refresh refuses unregistered or wrong-hash drift', async () => {
    const divs = await compareUnitSets(
      { unit: surface() },
      { unit: surface('.a{color:blue}') }
    );
    const wrong: RegisterEntry[] = divs.map((d) => ({
      unit: d.unit,
      artifact: d.artifact,
      category: 'intentional-correctness',
      note: 'wrong candidate hash',
      status: 'active',
      baselineSha256: d.baselineSha256,
      candidateSha256: 'f'.repeat(64),
    }));

    expect(() => assertRefreshEligible(divs, [])).toThrow(/unregistered/);
    expect(() => assertRefreshEligible(divs, wrong)).toThrow(
      /register invalid/
    );
  });

  test('refresh validates production and development licenses as one pair', async () => {
    const production = await compareUnitSets(
      { unit: surface() },
      { unit: surface('.production{}') }
    );
    const development = await compareUnitSets(
      { unit: surface() },
      { unit: surface('.development{}') }
    );
    const register = [...production, ...development].map(
      (d): RegisterEntry => ({
        unit: d.unit,
        artifact: d.artifact,
        category: 'intentional-correctness',
        note: 'mode-specific exact drift',
        status: 'active',
        baselineSha256: d.baselineSha256,
        candidateSha256: d.candidateSha256,
      })
    );

    expect(() =>
      assertRefreshPairEligible({ production, development }, register)
    ).not.toThrow();
  });

  test('refresh evaluates family verdicts against licensed drift', async () => {
    const divs = await compareUnitSets(
      { unit: surface() },
      { unit: surface('.intentional{}') }
    );
    const register = divs.map(
      (d): RegisterEntry => ({
        unit: d.unit,
        artifact: d.artifact,
        category: 'intentional-correctness',
        note: 'exact but family still expects identity',
        status: 'active',
        baselineSha256: d.baselineSha256,
        candidateSha256: d.candidateSha256,
      })
    );

    expect(
      refreshFamilyErrors(
        [{ family: 'f', units: ['unit'], expectedVerdict: 'identical' }],
        divs,
        register
      )
    ).toEqual([expect.stringContaining('expected identical')]);
  });

  test('pair refresh accepts an exact registered family transition in one mode', async () => {
    const production = await compareUnitSets(
      { unit: surface() },
      { unit: surface('.production-only{}') }
    );
    const register = production.map(
      (d): RegisterEntry => ({
        unit: d.unit,
        artifact: d.artifact,
        category: 'intentional-correctness',
        note: 'production-only family transition',
        status: 'active',
        baselineSha256: d.baselineSha256,
        candidateSha256: d.candidateSha256,
      })
    );
    const families = [
      {
        family: 'f',
        units: ['unit'],
        expectedVerdict: 'registered-divergence' as const,
        registerCategory: 'intentional-correctness' as const,
      },
    ];

    expect(
      refreshPairFamilyErrors(
        families,
        { production, development: [] },
        register
      )
    ).toEqual([]);
    expect(refreshFamilyErrors(families, [], register)).toEqual([
      expect.stringContaining('expected registered divergence'),
    ]);
  });

  test('publishes both mode baselines as one directory transaction', () => {
    const root = mkdtempSync(join(tmpdir(), 'animus-parity-baseline-'));
    const production = createBaselineEnvelope(
      'production',
      'seed',
      'c'.repeat(64),
      { unit: surface() }
    );
    const development = createBaselineEnvelope(
      'development',
      'seed',
      'c'.repeat(64),
      { unit: surface() }
    );

    writeBaselinePairAtomic(root, production, development);

    expect(
      JSON.parse(readFileSync(join(root, 'v2/production.json'), 'utf8')).mode
    ).toBe('production');
    expect(
      JSON.parse(readFileSync(join(root, 'v2/development.json'), 'utf8')).mode
    ).toBe('development');
  });

  test.each([
    ['production determinism', 'production', 'determinism'],
    ['development family invariant', 'development', 'families'],
  ] as const)(
    'a %s failure preserves both existing mode baselines',
    (_label, failedMode, failedCheck) => {
      const root = mkdtempSync(join(tmpdir(), 'animus-parity-baseline-'));
      const oldProduction = createBaselineEnvelope(
        'production',
        'old',
        'c'.repeat(64),
        { unit: surface() }
      );
      const oldDevelopment = createBaselineEnvelope(
        'development',
        'old',
        'c'.repeat(64),
        { unit: surface() }
      );
      writeBaselinePairAtomic(root, oldProduction, oldDevelopment);
      const beforeProduction = readFileSync(
        join(root, 'v2/production.json'),
        'utf8'
      );
      const beforeDevelopment = readFileSync(
        join(root, 'v2/development.json'),
        'utf8'
      );
      const checks: Record<BaselineMode, BaselineRefreshChecks> = {
        production: {
          determinism: [],
          cssValidity: [],
          parseBudget: [],
          families: [],
        },
        development: {
          determinism: [],
          cssValidity: [],
          parseBudget: [],
          families: [],
        },
      };
      if (failedCheck === 'determinism') {
        checks[failedMode].determinism.push({
          unit: 'unit',
          artifact: 'observables',
          detail: 'thread surfaces differ',
          baselineSha256: 'a'.repeat(64),
          candidateSha256: 'b'.repeat(64),
        });
      } else {
        checks[failedMode].families.push('family violated');
      }

      expect(() =>
        writeValidatedBaselinePair(
          root,
          createBaselineEnvelope('production', 'new', 'c'.repeat(64), {
            unit: surface('.new{}'),
          }),
          createBaselineEnvelope('development', 'new', 'c'.repeat(64), {
            unit: surface('.new{}'),
          }),
          checks
        )
      ).toThrow(/not green/);
      expect(readFileSync(join(root, 'v2/production.json'), 'utf8')).toBe(
        beforeProduction
      );
      expect(readFileSync(join(root, 'v2/development.json'), 'utf8')).toBe(
        beforeDevelopment
      );
    }
  );

  test('a mismatched mode pair is rejected before replacement', () => {
    const root = mkdtempSync(join(tmpdir(), 'animus-parity-baseline-'));
    const oldProduction = createBaselineEnvelope(
      'production',
      'old',
      'c'.repeat(64),
      { unit: surface() }
    );
    const oldDevelopment = createBaselineEnvelope(
      'development',
      'old',
      'c'.repeat(64),
      { unit: surface() }
    );
    writeBaselinePairAtomic(root, oldProduction, oldDevelopment);
    const beforeProduction = readFileSync(
      join(root, 'v2/production.json'),
      'utf8'
    );
    const beforeDevelopment = readFileSync(
      join(root, 'v2/development.json'),
      'utf8'
    );
    const green: Record<BaselineMode, BaselineRefreshChecks> = {
      production: {
        determinism: [],
        cssValidity: [],
        parseBudget: [],
        families: [],
      },
      development: {
        determinism: [],
        cssValidity: [],
        parseBudget: [],
        families: [],
      },
    };

    expect(() =>
      writeValidatedBaselinePair(
        root,
        createBaselineEnvelope('production', 'new', 'c'.repeat(64), {
          unit: surface('.new{}'),
        }),
        createBaselineEnvelope('production', 'new', 'c'.repeat(64), {
          unit: surface('.new{}'),
        }),
        green
      )
    ).toThrow(/envelope/);
    expect(readFileSync(join(root, 'v2/production.json'), 'utf8')).toBe(
      beforeProduction
    );
    expect(readFileSync(join(root, 'v2/development.json'), 'utf8')).toBe(
      beforeDevelopment
    );
  });
});
