// scripts/verify/attw-def5.test.ts
//
// Behavior tests for the bounded DEF-5 type-resolution gate (design D5/DEF-2,
// G6, spec "Suppressed type diagnostics remain bounded"). Fixtures are minimal
// attw-shaped analysis objects; the validator runs against them, not against a
// script's source string (design D6).

import { describe, expect, test } from 'vitest';

import {
  DEF5_BASELINE,
  evaluateDef5,
  isEsmOnlyVisible,
  resolutionTag,
} from './attw-def5';

const PKG = '@animus-ui/properties';

// Builds an esm-only-visible internal-resolution-error problem for the
// properties package.
function ire(file: string, specifier: string) {
  return {
    kind: 'InternalResolutionError',
    resolutionOption: 'node16',
    resolutionMode: 99,
    fileName: `/node_modules/${PKG}/${file}`,
    moduleSpecifier: specifier,
  };
}

// An ignored-mode problem (node10 / node16-cjs) — invisible to the gate.
const NODE10_NO_RESOLUTION = {
  kind: 'NoResolution',
  entrypoint: '.',
  resolutionKind: 'node10',
};
const CJS_RESOLVES_TO_ESM = {
  kind: 'CJSResolvesToESM',
  entrypoint: '.',
  resolutionKind: 'node16-cjs',
};

function analysisWith(problems: unknown[]) {
  return { packageName: PKG, problems };
}

// The exact baseline for properties, rendered as attw problems.
function baselineProblems() {
  return DEF5_BASELINE[PKG].map((t) => ire(t.file, t.specifier));
}

describe('resolutionTag / isEsmOnlyVisible', () => {
  test('node16 + mode 99 → node16-esm, visible', () => {
    const p = ire('dist/index.d.ts', './shorthands');
    expect(resolutionTag(p)).toBe('node16-esm');
    expect(isEsmOnlyVisible(p)).toBe(true);
  });

  test('node10 NoResolution is ignored', () => {
    expect(resolutionTag(NODE10_NO_RESOLUTION)).toBe('node10');
    expect(isEsmOnlyVisible(NODE10_NO_RESOLUTION)).toBe(false);
  });

  test('node16-cjs CJSResolvesToESM is ignored', () => {
    expect(resolutionTag(CJS_RESOLVES_TO_ESM)).toBe('node16-cjs');
    expect(isEsmOnlyVisible(CJS_RESOLVES_TO_ESM)).toBe(false);
  });
});

describe('evaluateDef5: exact-set acceptance', () => {
  test('baseline-exact set passes, ignored-mode noise does not matter', () => {
    const analysis = analysisWith([
      ...baselineProblems(),
      NODE10_NO_RESOLUTION,
      CJS_RESOLVES_TO_ESM,
    ]);
    const r = evaluateDef5(analysis, PKG);
    expect(r.ok).toBe(true);
    expect(r.messages[0]).toMatch(/bounded DEF-5 diagnostic/);
  });

  test('duplicate occurrences of the same tuple collapse (still exact)', () => {
    const analysis = analysisWith([
      ...baselineProblems(),
      ire('dist/index.d.ts', './shorthands'), // duplicate of a baseline tuple
    ]);
    expect(evaluateDef5(analysis, PKG).ok).toBe(true);
  });
});

describe('evaluateDef5: fail-closed on drift', () => {
  test('an ADDITIONAL internal-resolution-error fails and is reported', () => {
    const analysis = analysisWith([
      ...baselineProblems(),
      ire('dist/index.d.ts', './brand-new-module'),
    ]);
    const r = evaluateDef5(analysis, PKG);
    expect(r.ok).toBe(false);
    expect(
      r.messages.some(
        (m) => m.includes('ADDED') && m.includes('./brand-new-module')
      )
    ).toBe(true);
  });

  test('a REMOVED (now-resolving) baseline diagnostic fails', () => {
    // Drop one baseline tuple: the accepted diagnostic now resolves, so the
    // exemption is obsolete and must be trimmed.
    const kept = baselineProblems().slice(1);
    const r = evaluateDef5(analysisWith(kept), PKG);
    expect(r.ok).toBe(false);
    expect(r.messages.some((m) => m.startsWith('REMOVED'))).toBe(true);
  });

  test('a NEW esm-only-visible non-IRE problem fails', () => {
    const analysis = analysisWith([
      ...baselineProblems(),
      {
        kind: 'NoResolution',
        entrypoint: './new-entry',
        resolutionKind: 'node16-esm', // visible under esm-only
      },
    ]);
    const r = evaluateDef5(analysis, PKG);
    expect(r.ok).toBe(false);
    expect(
      r.messages.some(
        (m) =>
          m.includes('ADDED non-resolution problem') &&
          m.includes('NoResolution')
      )
    ).toBe(true);
  });

  test('malformed analysis fails closed', () => {
    expect(evaluateDef5(null, PKG).ok).toBe(false);
    expect(evaluateDef5(undefined, PKG).ok).toBe(false);
  });
});
