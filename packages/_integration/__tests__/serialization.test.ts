import { join } from 'node:path';
/**
 * Serialization boundary tests: serialize → NAPI round-trip.
 *
 * Verifies that output from ds.toConfig() and tokens.serialize()
 * constitutes valid input to analyzeProject().
 */
import { beforeAll, describe, expect, test } from 'vitest';

import { readFixtureFile } from '../fixtures/read-fixtures';
import { config, theme } from '../fixtures/setup';

const {
  analyzeProject,
  clearAnalysisCache,
} = require('../../extract/index.js');

const COMPONENTS = join(__dirname, '..', 'fixtures', 'components');

beforeAll(() => {
  clearAnalysisCache();
});

describe('serialization shape', () => {
  test('ds.toConfig() returns propConfig, groupRegistry, transforms', () => {
    expect(typeof config.propConfig).toBe('string');
    expect(typeof config.groupRegistry).toBe('string');
    expect(typeof config.transforms).toBe('object');

    // propConfig and groupRegistry must be valid JSON
    expect(() => JSON.parse(config.propConfig)).not.toThrow();
    expect(() => JSON.parse(config.groupRegistry)).not.toThrow();
  });

  test('tokens.serialize() returns scalesJson, variableMapJson, variableCss, contextualVarsJson', () => {
    expect(typeof theme.scalesJson).toBe('string');
    expect(typeof theme.variableMapJson).toBe('string');
    expect(typeof theme.variableCss).toBe('string');
    expect(typeof theme.contextualVarsJson).toBe('string');

    // JSON fields must be valid JSON
    expect(() => JSON.parse(theme.scalesJson)).not.toThrow();
    expect(() => JSON.parse(theme.variableMapJson)).not.toThrow();
  });
});

describe('serialize → NAPI round-trip', () => {
  test('serialized output feeds analyzeProject successfully', () => {
    const entry = readFixtureFile(COMPONENTS, 'button.tsx');
    const fileEntries = JSON.stringify([entry]);

    const manifestJson = analyzeProject(
      fileEntries,
      theme.scalesJson,
      theme.variableMapJson,
      theme.contextualVarsJson || null,
      config.propConfig,
      config.groupRegistry,
      '{}',
      false,
      null
    );

    expect(typeof manifestJson).toBe('string');
    const manifest = JSON.parse(manifestJson);
    expect(manifest).toBeDefined();
    expect(manifest.css).toBeDefined();
  });

  test('manifest contains @layer declarations', () => {
    const entry = readFixtureFile(COMPONENTS, 'button.tsx');
    const fileEntries = JSON.stringify([entry]);

    const manifestJson = analyzeProject(
      fileEntries,
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
    expect(manifest.css).toContain('@layer');
  });

  test('manifest contains component extraction data', () => {
    const entry = readFixtureFile(COMPONENTS, 'button.tsx');
    const fileEntries = JSON.stringify([entry]);

    const manifestJson = analyzeProject(
      fileEntries,
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
    expect(manifest.report).toBeDefined();
    expect(manifest.report.components_extracted).toBeGreaterThan(0);
  });
});
