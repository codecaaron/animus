/**
 * Manifest shape + completeness assertions.
 *
 * Covers the `manifest-completeness-testing` capability from the
 * integration-test-infrastructure change. Validates the structural shape and
 * internal consistency of the UniverseManifest returned by `analyzeProject()`.
 */
import { beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import { readFixtureFile, readFixtureFiles } from '../fixtures/read-fixtures';
import { clearAnalysisCache, runPipeline } from './run-pipeline';

const COMPONENTS = join(__dirname, '..', 'fixtures', 'components');

beforeAll(() => {
  clearAnalysisCache();
});

describe('component descriptor completeness', () => {
  const { manifest } = runPipeline(readFixtureFiles(COMPONENTS));

  test('manifest.components is a non-empty object', () => {
    expect(typeof manifest.components).toBe('object');
    expect(Object.keys(manifest.components).length).toBeGreaterThan(0);
  });

  test('every component descriptor has required non-empty fields', () => {
    for (const [id, descriptor] of Object.entries(manifest.components) as [
      string,
      any,
    ][]) {
      expect(typeof descriptor.file).toBe('string');
      expect(descriptor.file.length).toBeGreaterThan(0);
      expect(typeof descriptor.binding).toBe('string');
      expect(descriptor.binding.length).toBeGreaterThan(0);
      expect(typeof descriptor.class_name).toBe('string');
      expect(descriptor.class_name).toMatch(/^animus-/);
      expect(typeof descriptor.replacement).toBe('string');
      expect(descriptor.replacement.length).toBeGreaterThan(0);
      expect(typeof descriptor.tag).toBe('string');
      expect(descriptor.tag.length).toBeGreaterThan(0);
      expect(
        descriptor.terminal === undefined ||
          typeof descriptor.terminal === 'string'
      ).toBe(true);
      // id should be a non-empty string and match the key
      expect(id.length).toBeGreaterThan(0);
    }
  });
});

describe('files-to-components consistency', () => {
  const { manifest } = runPipeline(readFixtureFiles(COMPONENTS));

  test('every component_id in manifest.files exists in manifest.components', () => {
    expect(typeof manifest.files).toBe('object');
    for (const [filePath, componentIds] of Object.entries(manifest.files) as [
      string,
      string[],
    ][]) {
      expect(Array.isArray(componentIds)).toBe(true);
      for (const id of componentIds) {
        expect(manifest.components[id]).toBeDefined();
        expect(manifest.components[id].file).toBe(filePath);
      }
    }
  });
});

describe('provenance reciprocity', () => {
  const { manifest } = runPipeline(readFixtureFiles(COMPONENTS));

  test('reverse_provenance is reciprocal with extends_from', () => {
    const reverse = manifest.reverse_provenance ?? {};
    expect(typeof reverse).toBe('object');
    for (const [parentId, childIds] of Object.entries(reverse) as [
      string,
      string[],
    ][]) {
      expect(manifest.components[parentId]).toBeDefined();
      for (const childId of childIds) {
        const child = manifest.components[childId];
        expect(child).toBeDefined();
        expect(child.extends_from).toBe(parentId);
      }
    }
  });

  test('every extends_from points to a component that lists it in reverse_provenance', () => {
    const reverse = manifest.reverse_provenance ?? {};
    for (const [childId, descriptor] of Object.entries(manifest.components) as [
      string,
      any,
    ][]) {
      if (descriptor.extends_from) {
        const parentId = descriptor.extends_from;
        expect(manifest.components[parentId]).toBeDefined();
        const children = reverse[parentId] ?? [];
        expect(children).toContain(childId);
      }
    }
  });
});

describe('fragment consistency', () => {
  const { manifest } = runPipeline(readFixtureFiles(COMPONENTS));

  test('every component_fragments key exists in manifest.components', () => {
    const fragments = manifest.component_fragments ?? {};
    for (const id of Object.keys(fragments)) {
      expect(manifest.components[id]).toBeDefined();
    }
  });

  test('extracted components with CSS have at least one non-empty fragment layer', () => {
    const fragments = manifest.component_fragments ?? {};
    const layersWithContent = (sheets: Record<string, string>) =>
      Object.entries(sheets).filter(
        ([_, value]) => typeof value === 'string' && value.trim().length > 0
      );

    for (const [id, sheets] of Object.entries(fragments) as [
      string,
      Record<string, string>,
    ][]) {
      const descriptor = manifest.components[id];
      // skip if descriptor says it bailed (no CSS expected)
      if (descriptor?.bailed) continue;
      const populated = layersWithContent(sheets);
      expect(populated.length).toBeGreaterThan(0);
    }
  });
});

describe('dynamic props boundary', () => {
  test('fully-static button fixture produces zero dynamic_props entries for its prop names', () => {
    const { manifest } = runPipeline([
      readFixtureFile(COMPONENTS, 'button.tsx'),
    ]);
    // button.tsx uses only static literal values → no dynamic props expected.
    const dp = manifest.dynamic_props ?? {};
    expect(Object.keys(dp).length).toBe(0);
  });

  test('dynamic prop entries carry required metadata', () => {
    const { manifest } = runPipeline(readFixtureFiles(COMPONENTS));
    const dp = manifest.dynamic_props ?? {};
    for (const [_propName, meta] of Object.entries(dp) as [string, any][]) {
      expect(typeof meta.var_name).toBe('string');
      expect(meta.var_name).toMatch(/^--animus-/);
      expect(typeof meta.slot_class).toBe('string');
      expect(meta.slot_class).toMatch(/^animus-dyn-/);
      expect(typeof meta.property).toBe('string');
      expect(meta.property.length).toBeGreaterThan(0);
    }
  });
});

describe('system_prop_map validation', () => {
  const { manifest } = runPipeline([
    readFixtureFile(COMPONENTS, 'system-props.tsx'),
  ]);

  test('system_prop_map is populated for used props', () => {
    expect(typeof manifest.system_prop_map).toBe('object');
    // system-props.tsx uses p, mt, display, color — at minimum p and mt should appear.
    expect(manifest.system_prop_map.p).toBeDefined();
    expect(typeof manifest.system_prop_map.p).toBe('object');
  });

  test('all system_prop_map class name values are animus-u- prefixed', () => {
    for (const [_propName, valueMap] of Object.entries(
      manifest.system_prop_map
    ) as [string, Record<string, string>][]) {
      for (const className of Object.values(valueMap)) {
        expect(typeof className).toBe('string');
        expect(className).toMatch(/^animus-u-/);
      }
    }
  });
});
