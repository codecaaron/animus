import { join } from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';

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
    expect(css).toContain('@layer anm-base');
    expect(css).toContain('@layer anm-variants');
  });

  test('variants layer uses sublayer structure for compose families', () => {
    expect(css).toContain('@layer standalone, composed;');
    expect(css).toContain('@layer standalone {');
    expect(css).toContain('@layer composed {');
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
  ] as const)(
    'shared size variant resolves fontSize %i to %s',
    (_fontSize, expectedRem) => {
      expect(css).toContain(expectedRem);
    }
  );

  test.each([
    ['primary', 'var(--color-primary)'],
    ['secondary', 'var(--color-secondary)'],
  ] as const)('Child intent "%s" resolves to %s', (_intent, expectedVar) => {
    expect(css).toContain(expectedVar);
  });

  test('composed inheritance rules emitted for shared variant', () => {
    expect(css).toMatch(/\.animus-Root-\w+--size-small\s+\.animus-Child-\w+/);
    expect(css).toMatch(/\.animus-Root-\w+--size-large\s+\.animus-Child-\w+/);
  });

  test('composed override rules emitted for shared variant', () => {
    expect(css).toMatch(
      /\.animus-Root-\w+\s+\.animus-Child-\w+\.animus-Child-\w+--size-small/
    );
    expect(css).toMatch(
      /\.animus-Root-\w+\s+\.animus-Child-\w+\.animus-Child-\w+--size-large/
    );
  });

  test('non-shared variant (intent) has no composed rules', () => {
    expect(css).not.toMatch(/\.animus-Root-\w+.*--intent/);
  });

  test('standalone variant CSS unchanged for components in a family', () => {
    expect(css).toMatch(/\.animus-Child-\w+--size-small\s*\{/);
    expect(css).toMatch(/\.animus-Child-\w+--size-large\s*\{/);
    expect(css).toMatch(/\.animus-Child-\w+--intent-primary\s*\{/);
  });

  test('no raw unresolved token names in output', () => {
    assertNoUnresolvedTokens(css);
  });
});
