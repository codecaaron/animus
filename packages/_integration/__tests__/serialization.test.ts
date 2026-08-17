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
import { analyzeProject, clearAnalysisCache } from './run-pipeline';

const COMPONENTS = join(__dirname, '..', 'fixtures', 'components');

beforeAll(() => {
  clearAnalysisCache();
});

describe('serialization shape', () => {
  test('ds.toConfig() returns propConfig, groupRegistry, transforms', () => {
    expect(config.propConfig).toEqual(expect.any(String));
    expect(config.groupRegistry).toEqual(expect.any(String));
    expect(config.transforms).toEqual(expect.any(Object));

    // propConfig and groupRegistry must be valid JSON
    expect(() => JSON.parse(config.propConfig)).not.toThrow();
    expect(() => JSON.parse(config.groupRegistry)).not.toThrow();
  });

  test('ds.toConfig() omits the retired selector order output', () => {
    expect(config.selectorAliases).toEqual(expect.any(String));
    expect(config).not.toHaveProperty('selectorOrder');
  });

  test('tokens.serialize() returns scalesJson, variableMapJson, variableCss, contextualVarsJson', () => {
    expect(theme.scalesJson).toEqual(expect.any(String));
    expect(theme.variableMapJson).toEqual(expect.any(String));
    expect(theme.variableCss).toEqual(expect.any(String));
    expect(theme.contextualVarsJson).toEqual(expect.any(String));

    // JSON fields must be valid JSON
    expect(() => JSON.parse(theme.scalesJson)).not.toThrow();
    expect(() => JSON.parse(theme.variableMapJson)).not.toThrow();
  });
});

describe('serialize → NAPI round-trip', () => {
  test('serialized output feeds analyzeProject successfully', () => {
    const entry = readFixtureFile(COMPONENTS, 'button.tsx');
    const fileEntries = JSON.stringify([entry]);

    const manifestJson = analyzeProject(fileEntries);

    expect(manifestJson).toEqual(expect.any(String));
    const manifest = JSON.parse(manifestJson);
    expect(manifest).toBeDefined();
    expect(manifest.css).toBeDefined();
  });

  test('manifest contains @layer declarations', () => {
    const entry = readFixtureFile(COMPONENTS, 'button.tsx');
    const fileEntries = JSON.stringify([entry]);

    const manifestJson = analyzeProject(fileEntries);

    const manifest = JSON.parse(manifestJson);
    expect(manifest.css).toContain('@layer');
  });

  test('manifest contains component extraction data', () => {
    const entry = readFixtureFile(COMPONENTS, 'button.tsx');
    const fileEntries = JSON.stringify([entry]);

    const manifestJson = analyzeProject(fileEntries);

    const manifest = JSON.parse(manifestJson);
    expect(manifest.report).toBeDefined();
    expect(manifest.report.components_extracted).toBeGreaterThan(0);
  });
});
