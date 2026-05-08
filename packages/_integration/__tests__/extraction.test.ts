import { resolveTransformPlaceholders } from '@animus-ui/extract/pipeline';
import { join } from 'node:path';
/**
 * Full pipeline integration tests: serialize → NAPI → post-process → assert CSS.
 *
 * Every step calls the real function from the real package.
 * Same code path as the vite-plugin, minus file discovery and subprocess.
 *
 * Organized by BEHAVIOR, not by component fixture.
 */
import { beforeAll, describe, expect, test } from 'vitest';

import { readFixtureFile, readFixtureFiles } from '../fixtures/read-fixtures';
import { config, theme } from '../fixtures/setup';
import { assertNoUnresolvedTokens } from './assert-no-unresolved-tokens';
import { clearAnalysisCache, runPipeline } from './run-pipeline';

const { analyzeProject } = require('../../extract/index.js');

const COMPONENTS = join(__dirname, '..', 'fixtures', 'components');

beforeAll(() => {
  clearAnalysisCache();
});

// ─── Variant Resolution ──────────────────────────────────────

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

// ─── Compound Resolution ─────────────────────────────────────

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

// ─── Transform Resolution ────────────────────────────────────

describe('transform resolution', () => {
  test('resolves __TRANSFORM__ placeholders with live transform functions', () => {
    const entry = readFixtureFile(COMPONENTS, 'transforms.tsx');
    const manifestJson = analyzeProject(
      JSON.stringify([entry]),
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
    const rawCss: string = manifest.css || '';

    if (rawCss.includes('__TRANSFORM__')) {
      const resolved = resolveTransformPlaceholders(rawCss, config.transforms);
      expect(resolved).not.toContain('__TRANSFORM__');
    }
  });

  test('no raw unresolved tokens after transform resolution', () => {
    const entry = readFixtureFile(COMPONENTS, 'transforms.tsx');
    const { css } = runPipeline([entry]);
    assertNoUnresolvedTokens(css);
  });
});

// ─── System Props ────────────────────────────────────────────

describe('system props extraction', () => {
  test('produces system_prop_map in manifest', () => {
    const entry = readFixtureFile(COMPONENTS, 'system-props.tsx');
    const { manifest } = runPipeline([entry]);

    expect(manifest.system_prop_map).toBeDefined();
    expect(typeof manifest.system_prop_map).toBe('object');
  });
});

// ─── Responsive Extraction ───────────────────────────────────

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

// ─── Multi-File Extraction ───────────────────────────────────

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
