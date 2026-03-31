/**
 * Composition integration tests: compose() through the full extraction pipeline.
 *
 * Verifies that composed slot components are extractable and produce
 * correct CSS with shared variant resolution.
 */
import { beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import { readFixtureFile } from '../fixtures/read-fixtures';
import { assertNoUnresolvedTokens } from './assert-no-unresolved-tokens';
import { clearAnalysisCache, runPipeline } from './run-pipeline';

const COMPONENTS = join(__dirname, '..', 'fixtures', 'components');

beforeAll(() => {
  clearAnalysisCache();
});

describe('composition extraction', () => {
  const entry = readFixtureFile(COMPONENTS, 'composition.tsx');
  const { manifest, css } = runPipeline([entry]);

  test('extracts composed components', () => {
    expect(manifest.report.components_extracted).toBe(2);
  });

  test('CSS contains @layer declarations', () => {
    expect(css).toContain('@layer base');
    expect(css).toContain('@layer variants');
  });

  test('Root slot base styles extracted', () => {
    expect(css).toContain('display: flex');
    expect(css).toContain('align-items: center');
  });

  test('Child slot base styles extracted', () => {
    expect(css).toContain('display: inline-flex');
  });

  test.each([
    [14, '0.875rem'],
    [20, '1.25rem'],
  ] as const)('shared size variant resolves fontSize %i to %s', (_fontSize, expectedRem) => {
    expect(css).toContain(expectedRem);
  });

  test.each([
    ['primary', 'var(--color-primary)'],
    ['secondary', 'var(--color-secondary)'],
  ] as const)('Child intent "%s" resolves to %s', (_intent, expectedVar) => {
    expect(css).toContain(expectedVar);
  });

  test('no raw unresolved token names in output', () => {
    assertNoUnresolvedTokens(css);
  });
});
