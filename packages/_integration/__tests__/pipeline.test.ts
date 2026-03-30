/**
 * Full pipeline integration tests: serialize → NAPI → post-process → assert CSS.
 *
 * Every step calls the real function from the real package.
 * Same code path as the vite-plugin, minus file discovery and subprocess.
 */
import { beforeAll, describe, expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import {
  applyUnitFallback,
  resolveTransformPlaceholders,
} from '@animus-ui/extract/pipeline';

import { readFixtureFile, readFixtureFiles } from '../fixtures/read-fixtures';
import { config, theme } from '../fixtures/setup';

const require = createRequire(import.meta.url);
const { analyzeProject, clearAnalysisCache } = require('@animus-ui/extract');

const COMPONENTS = join(__dirname, '..', 'fixtures', 'components');

/**
 * Run the full pipeline on given file entries: NAPI → transform resolution → unit fallback.
 */
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

  // Resolve transform placeholders using live functions
  if (css.includes('__TRANSFORM__') && config.transforms) {
    css = resolveTransformPlaceholders(css, config.transforms);
  }

  // Apply unit fallback
  css = applyUnitFallback(css);

  return { manifest, css };
}

beforeAll(() => {
  clearAnalysisCache();
});

describe('button extraction', () => {
  test('extracts base styles, variants, and states through full pipeline', () => {
    const entry = readFixtureFile(COMPONENTS, 'button.tsx');
    const { css } = runPipeline([entry]);

    // Base styles in @layer base
    expect(css).toContain('@layer base');
    expect(css).toContain('display: inline-flex');
    expect(css).toContain('cursor: pointer');

    // Variant styles in @layer variants
    expect(css).toContain('@layer variants');

    // State styles in @layer states
    expect(css).toContain('@layer states');
    expect(css).toContain('opacity');
  });

  test('variant styles contain size and intent options', () => {
    const entry = readFixtureFile(COMPONENTS, 'button.tsx');
    const { css } = runPipeline([entry]);

    // Size variants produce different font sizes
    expect(css).toContain('0.875rem'); // fontSize: 14 → scale
    expect(css).toContain('1rem'); // fontSize: 16 → scale
    expect(css).toContain('1.25rem'); // fontSize: 20 → scale
  });
});

describe('compound variants extraction', () => {
  test('extracts compound rules in @layer compounds', () => {
    const entry = readFixtureFile(COMPONENTS, 'compounds.tsx');
    const { css } = runPipeline([entry]);

    expect(css).toContain('@layer compounds');
    // Compound of size:small + intent:danger → fontWeight: 700
    expect(css).toContain('font-weight: 700');
  });
});

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
      // Transform placeholders exist in raw NAPI output
      const resolved = resolveTransformPlaceholders(rawCss, config.transforms);
      // After resolution, no placeholders remain
      expect(resolved).not.toContain('__TRANSFORM__');
    }
  });
});

describe('system props extraction', () => {
  test('produces system_prop_map in manifest', () => {
    const entry = readFixtureFile(COMPONENTS, 'system-props.tsx');
    const { manifest } = runPipeline([entry]);

    expect(manifest.system_prop_map).toBeDefined();
    expect(typeof manifest.system_prop_map).toBe('object');
  });
});

describe('responsive extraction', () => {
  test('produces @media queries with correct breakpoint values', () => {
    const entry = readFixtureFile(COMPONENTS, 'layout.tsx');
    const { css } = runPipeline([entry]);

    // Breakpoints from unified fixture: sm: 768, md: 1024, lg: 1200
    expect(css).toContain('@media');
    expect(css).toContain('768px');
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
});
