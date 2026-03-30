/**
 * Composition integration tests: compose() through the full extraction pipeline.
 *
 * Verifies that composed slot components are extractable and produce
 * correct CSS with shared variant resolution.
 */
import { beforeAll, describe, expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import {
  applyUnitFallback,
  resolveTransformPlaceholders,
} from '@animus-ui/extract/pipeline';

import { readFixtureFile } from '../fixtures/read-fixtures';
import { config, theme } from '../fixtures/setup';
import { assertNoUnresolvedTokens } from './assert-no-unresolved-tokens';

const require = createRequire(import.meta.url);
const { analyzeProject, clearAnalysisCache } = require('@animus-ui/extract');

const COMPONENTS = join(__dirname, '..', 'fixtures', 'components');

function runPipeline(fileEntries: Array<{ path: string; source: string }>) {
  const manifestJson = analyzeProject(
    JSON.stringify(fileEntries),
    theme.scalesJson,
    theme.variableMapJson,
    theme.contextualVarsJson || null,
    config.propConfig,
    config.groupRegistry,
    '{}',
    false,
    null
  );

  const manifest = JSON.parse(manifestJson);
  let css: string = manifest.css || '';

  if (css.includes('__TRANSFORM__') && config.transforms) {
    css = resolveTransformPlaceholders(css, config.transforms);
  }

  css = applyUnitFallback(css);
  return { manifest, css };
}

beforeAll(() => {
  clearAnalysisCache();
});

describe('composition extraction', () => {
  const entry = readFixtureFile(COMPONENTS, 'composition.tsx');
  const { manifest, css } = runPipeline([entry]);

  test('extracts composed components', () => {
    expect(manifest.report.components_extracted).toBeGreaterThanOrEqual(2);
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
