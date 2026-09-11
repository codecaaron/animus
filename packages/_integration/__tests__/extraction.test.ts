import { join } from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';

import { readFixtureFile, readFixtureFiles } from '../fixtures/read-fixtures';
import { assertNoUnresolvedTokens } from './assert-no-unresolved-tokens';
import {
  analyzeProject,
  clearAnalysisCache,
  runPipeline,
} from './run-pipeline';

const COMPONENTS = join(__dirname, '..', 'fixtures', 'components');

beforeAll(() => {
  clearAnalysisCache();
});

describe('variant resolution', () => {
  const entry = readFixtureFile(COMPONENTS, 'button.tsx');
  const { css } = runPipeline([entry]);

  test('base styles extract in @layer base', () => {
    expect(css).toContain('@layer anm-base');
    expect(css).toContain('display: inline-flex');
    expect(css).toContain('cursor: pointer');
  });

  test('variant styles in @layer variants', () => {
    expect(css).toContain('@layer anm-variants');
  });

  test('state styles in @layer states', () => {
    expect(css).toContain('@layer anm-states');
    expect(css).toContain('opacity');
  });

  test.each([
    ['small', '0.875rem'],
    ['medium', '1rem'],
    ['large', '1.25rem'],
  ] as const)(
    'size variant "%s" resolves fontSize to %s',
    (_size, expectedRem) => {
      expect(css).toContain(expectedRem);
    }
  );

  test.each([
    ['primary', 'var(--color-primary)'],
    ['secondary', 'var(--color-secondary)'],
  ] as const)('intent variant "%s" resolves to %s', (_intent, expectedVar) => {
    expect(css).toContain(expectedVar);
  });

  test('no raw unresolved token names in output', () => {
    assertNoUnresolvedTokens(css);
  });
});

describe('compound resolution', () => {
  const entry = readFixtureFile(COMPONENTS, 'compounds.tsx');
  const { css } = runPipeline([entry]);

  test('compound rules in @layer compounds', () => {
    expect(css).toContain('@layer anm-compounds');
    expect(css).toContain('--compound-0');
    expect(css).toContain('--compound-1');
  });

  test('compound 0: size:small + intent:danger → fontWeight: 700', () => {
    expect(css).toContain('font-weight: 700');
  });

  test('compound 1: size:large + intent:info → borderRadius resolved', () => {
    expect(css).toMatch(/compound-1[\s\S]*?border-radius:/);
  });

  test.each([
    ['primary', 'var(--color-primary)'],
    ['secondary', 'var(--color-secondary)'],
    ['background', 'var(--color-background)'],
  ] as const)('intent "%s" resolves to %s', (_intent, expectedVar) => {
    expect(css).toContain(expectedVar);
  });

  test.each([
    [14, '0.875rem'],
    [16, '1rem'],
  ] as const)('fontSize %i resolves to %s via scale', (_size, expectedRem) => {
    expect(css).toContain(expectedRem);
  });

  test.each([
    [4, '0.25rem'],
    [8, '0.5rem'],
  ] as const)('px %i resolves to %s via space scale', (_px, expectedRem) => {
    expect(css).toContain(expectedRem);
  });

  test('no raw unresolved token names in output', () => {
    assertNoUnresolvedTokens(css);
  });
});

describe('transform resolution', () => {
  test('evaluates extracted named transforms in Rust', () => {
    const entry = readFixtureFile(COMPONENTS, 'transforms.tsx');
    const manifestJson = analyzeProject(JSON.stringify([entry]));

    const manifest = JSON.parse(manifestJson);
    const rawCss: string = manifest.css || '';

    expect(rawCss).toContain('width: 8px');
    expect(rawCss).not.toContain('__TRANSFORM__');
  });

  test('no raw unresolved tokens after transform resolution', () => {
    const entry = readFixtureFile(COMPONENTS, 'transforms.tsx');
    const { css } = runPipeline([entry]);
    assertNoUnresolvedTokens(css);
  });
});

describe('responsive extraction', () => {
  test('produces @media queries with correct breakpoint values', () => {
    const entry = readFixtureFile(COMPONENTS, 'layout.tsx');
    const { css } = runPipeline([entry]);

    expect(css).toContain('@media');
    expect(css).toContain('768px');
  });

  test('no raw unresolved tokens in responsive output', () => {
    const entry = readFixtureFile(COMPONENTS, 'layout.tsx');
    const { css } = runPipeline([entry]);
    assertNoUnresolvedTokens(css);
  });
});

describe('multi-file extraction', () => {
  test('extracts all components when given multiple files', () => {
    const entries = readFixtureFiles(COMPONENTS);
    const { manifest, css } = runPipeline(entries);

    expect(manifest.report.components_extracted).toBeGreaterThan(1);
    expect(css).toContain('@layer');
    expect(css.length).toBeGreaterThan(100);
  });

  test('no raw unresolved tokens in multi-file output', () => {
    const entries = readFixtureFiles(COMPONENTS);
    const { css } = runPipeline(entries);
    assertNoUnresolvedTokens(css);
  });
});
