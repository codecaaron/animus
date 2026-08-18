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

describe('serialize → NAPI round-trip', () => {
  test('serialized system + theme output feeds analyzeProject and yields layered CSS', () => {
    // The JSON-bearing fields must parse (spec: "valid JSON strings accepted
    // by analyzeProject()"); variableCss/contextualVarsJson are plain strings
    // with no JSON.parse counterpart.
    expect(() => JSON.parse(config.propConfig)).not.toThrow();
    expect(() => JSON.parse(config.groupRegistry)).not.toThrow();
    expect(() => JSON.parse(theme.scalesJson)).not.toThrow();
    expect(() => JSON.parse(theme.variableMapJson)).not.toThrow();
    expect(theme.variableCss).toEqual(expect.any(String));
    expect(theme.contextualVarsJson).toEqual(expect.any(String));
    expect(config).not.toHaveProperty('selectorOrder');

    // One boundary crossing proves acceptance: non-empty layered CSS plus a
    // populated report from the single-file entry.
    const entry = readFixtureFile(COMPONENTS, 'button.tsx');
    const manifest = JSON.parse(analyzeProject(JSON.stringify([entry])));
    expect(manifest.css).toContain('@layer');
    expect(manifest.report.components_extracted).toBeGreaterThan(0);
  });
});
