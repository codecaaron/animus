import { isJsonObject, isJsonString } from '@animus-ui/assertions';
import { join } from 'node:path';
/**
 * `ProjectManifest` mirrors a Rust struct with no compile-time link, so the
 * runtime decoding below is what catches a renamed or dropped field.
 */
import { beforeAll, describe, expect, test } from 'vitest';

import { readFixtureFile, readFixtureFiles } from '../fixtures/read-fixtures';
import { clearAnalysisCache, runPipeline } from './run-pipeline';

import type { JsonObject, JsonValue } from '@animus-ui/assertions';
import type {
  DynamicPropMeta,
  ManifestComponentDescriptor,
  ManifestComponentSheets,
  ProjectManifest,
} from '@animus-ui/extract/pipeline';

const COMPONENTS = join(__dirname, '..', 'fixtures', 'components');

type IntegrationManifest = Pick<
  ProjectManifest,
  | 'components'
  | 'files'
  | 'reverse_provenance'
  | 'component_fragments'
  | 'dynamic_props'
  | 'system_prop_map'
>;

function isStringArray(value: JsonValue): value is string[] {
  return Array.isArray(value) && value.every(isJsonString);
}

function isComponentDescriptor(
  value: JsonValue
): value is JsonObject & ManifestComponentDescriptor {
  return (
    isJsonObject(value) &&
    isJsonString(value.file) &&
    isJsonString(value.binding) &&
    isJsonString(value.class_name) &&
    isJsonString(value.replacement) &&
    isJsonString(value.tag) &&
    isJsonString(value.terminal) &&
    // Emitted as `null` for a root component, never omitted.
    (value.extends_from === null || isJsonString(value.extends_from)) &&
    isStringArray(value.system_prop_names)
  );
}

function isDynamicPropMetadata(
  value: JsonValue
): value is JsonObject & DynamicPropMeta {
  return (
    isJsonObject(value) &&
    isJsonString(value.varName) &&
    isJsonString(value.slotClass) &&
    isJsonString(value.property)
  );
}

function parseManifestComponents(candidate: JsonValue) {
  if (!isJsonObject(candidate)) {
    throw new TypeError('manifest.components must be an object');
  }
  const components: ProjectManifest['components'] = {};
  for (const [componentId, descriptor] of Object.entries(candidate)) {
    if (!isComponentDescriptor(descriptor)) {
      throw new TypeError(`manifest.components.${componentId} is malformed`);
    }
    components[componentId] = descriptor;
  }
  return components;
}

function parseStringLists(
  candidate: JsonValue,
  field: 'files' | 'reverse_provenance'
) {
  if (!isJsonObject(candidate)) {
    throw new TypeError(`manifest.${field} must be an object`);
  }
  const entries: ProjectManifest['files'] = {};
  for (const [key, value] of Object.entries(candidate)) {
    if (!isStringArray(value)) {
      throw new TypeError(`manifest.${field}.${key} must be a string array`);
    }
    entries[key] = value;
  }
  return entries;
}

function parseComponentFragments(candidate: JsonValue) {
  if (!isJsonObject(candidate)) {
    throw new TypeError('manifest.component_fragments must be an object');
  }
  const fragments: ProjectManifest['component_fragments'] = {};
  for (const [componentId, layers] of Object.entries(candidate)) {
    if (!isJsonObject(layers)) {
      throw new TypeError(
        `manifest.component_fragments.${componentId} must be an object`
      );
    }
    const parsedLayers: ManifestComponentSheets = {};
    for (const [layer, css] of Object.entries(layers)) {
      if (!isJsonString(css)) {
        throw new TypeError(
          `manifest.component_fragments.${componentId}.${layer} must be a string`
        );
      }
      if (!isFragmentLayer(layer)) {
        throw new TypeError(
          `manifest.component_fragments.${componentId}.${layer} is not a splittable layer`
        );
      }
      parsedLayers[layer] = css;
    }
    fragments[componentId] = parsedLayers;
  }
  return fragments;
}

const FRAGMENT_LAYERS = [
  'base',
  'variants',
  'compounds',
  'states',
] as const satisfies ReadonlyArray<keyof ManifestComponentSheets>;

function isFragmentLayer(
  layer: string
): layer is (typeof FRAGMENT_LAYERS)[number] {
  return FRAGMENT_LAYERS.some((known) => known === layer);
}

function parseDynamicProps(candidate: JsonValue) {
  if (!isJsonObject(candidate)) {
    throw new TypeError('manifest.dynamic_props must be an object');
  }
  const dynamicProps: ProjectManifest['dynamic_props'] = {};
  for (const [propName, metadata] of Object.entries(candidate)) {
    if (!isDynamicPropMetadata(metadata)) {
      throw new TypeError(`manifest.dynamic_props.${propName} is malformed`);
    }
    dynamicProps[propName] = metadata;
  }
  return dynamicProps;
}

function parseSystemPropMap(candidate: JsonValue) {
  if (!isJsonObject(candidate)) {
    throw new TypeError('manifest.system_prop_map must be an object');
  }
  const propMap: ProjectManifest['system_prop_map'] = {};
  for (const [propName, values] of Object.entries(candidate)) {
    if (!isJsonObject(values)) {
      throw new TypeError(
        `manifest.system_prop_map.${propName} must be an object`
      );
    }
    const parsedValues: Record<string, string> = {};
    for (const [value, className] of Object.entries(values)) {
      if (!isJsonString(className)) {
        throw new TypeError(
          `manifest.system_prop_map.${propName}.${value} must be a string`
        );
      }
      parsedValues[value] = className;
    }
    propMap[propName] = parsedValues;
  }
  return propMap;
}

function parseIntegrationManifest(candidate: JsonValue): IntegrationManifest {
  if (!isJsonObject(candidate)) {
    throw new TypeError('pipeline manifest must be an object');
  }
  // The producer emits every field for every project, empty ones as `{}`, so
  // an absent field is a contract break rather than something to default.
  return {
    components: parseManifestComponents(candidate.components),
    files: parseStringLists(candidate.files, 'files'),
    reverse_provenance: parseStringLists(
      candidate.reverse_provenance,
      'reverse_provenance'
    ),
    component_fragments: parseComponentFragments(candidate.component_fragments),
    dynamic_props: parseDynamicProps(candidate.dynamic_props),
    system_prop_map: parseSystemPropMap(candidate.system_prop_map),
  };
}

beforeAll(() => {
  clearAnalysisCache();
});

describe('component descriptor completeness', () => {
  const manifest = parseIntegrationManifest(
    runPipeline(readFixtureFiles(COMPONENTS)).manifest
  );

  test('manifest.components is a non-empty object', () => {
    // Vacuity anchor for the descriptor loop in the next test.
    expect(Object.keys(manifest.components).length).toBeGreaterThan(0);
  });

  test('every component descriptor has required non-empty fields', () => {
    for (const [id, descriptor] of Object.entries(manifest.components)) {
      expect(id.length).toBeGreaterThan(0);
      expect(descriptor.class_name).toMatch(/^animus-/);
      const emptyFields = (
        ['file', 'binding', 'replacement', 'tag', 'terminal'] as const
      ).filter((field) => descriptor[field].length === 0);
      expect(emptyFields).toEqual([]);
    }
  });
});

describe('files-to-components consistency', () => {
  const manifest = parseIntegrationManifest(
    runPipeline(readFixtureFiles(COMPONENTS)).manifest
  );

  test('every component_id in manifest.files exists in manifest.components', () => {
    // Vacuity anchor for the loop below.
    expect(Object.keys(manifest.files).length).toBeGreaterThan(0);
    for (const [filePath, componentIds] of Object.entries(manifest.files)) {
      for (const id of componentIds) {
        expect(manifest.components[id]).toBeDefined();
        expect(manifest.components[id].file).toBe(filePath);
      }
    }
  });
});

describe('provenance reciprocity', () => {
  const manifest = parseIntegrationManifest(
    runPipeline(readFixtureFiles(COMPONENTS)).manifest
  );

  test('reverse_provenance is reciprocal with extends_from', () => {
    const reverse = manifest.reverse_provenance;
    expect(Object.keys(reverse).length).toBeGreaterThan(0);
    for (const [parentId, childIds] of Object.entries(reverse)) {
      expect(manifest.components[parentId]).toBeDefined();
      for (const childId of childIds) {
        const child = manifest.components[childId];
        expect(child).toBeDefined();
        expect(child.extends_from).toBe(parentId);
      }
    }
  });

  test('every extends_from points to a component that lists it in reverse_provenance', () => {
    const reverse = manifest.reverse_provenance;
    for (const [childId, descriptor] of Object.entries(manifest.components)) {
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
  const manifest = parseIntegrationManifest(
    runPipeline(readFixtureFiles(COMPONENTS)).manifest
  );

  test('every component_fragments key exists in manifest.components', () => {
    const fragments = manifest.component_fragments;
    for (const id of Object.keys(fragments)) {
      expect(manifest.components[id]).toBeDefined();
    }
  });

  test('extracted components with CSS have at least one non-empty fragment layer', () => {
    const fragments = manifest.component_fragments;
    const layersWithContent = (sheets: ManifestComponentSheets) =>
      Object.values(sheets).filter((value) => value.trim().length > 0);

    // A fragment record exists only for a component that produced CSS.
    for (const sheets of Object.values(fragments)) {
      expect(layersWithContent(sheets).length).toBeGreaterThan(0);
    }
  });
});

describe('dynamic props boundary', () => {
  test('fully-static button fixture produces zero dynamic_props entries for its prop names', () => {
    const manifest = parseIntegrationManifest(
      runPipeline([readFixtureFile(COMPONENTS, 'button.tsx')]).manifest
    );
    const dp = manifest.dynamic_props;
    expect(Object.keys(dp).length).toBe(0);
  });

  test('dynamic prop entries carry required metadata', () => {
    const manifest = parseIntegrationManifest(
      runPipeline(readFixtureFiles(COMPONENTS)).manifest
    );
    const dp = manifest.dynamic_props;
    for (const [_propName, meta] of Object.entries(dp)) {
      expect(meta.varName).toEqual(expect.any(String));
      expect(meta.varName).toMatch(/^--animus-/);
      expect(meta.slotClass).toEqual(expect.any(String));
      expect(meta.slotClass).toMatch(/^animus-dyn-/);
      expect(meta.property).toEqual(expect.any(String));
      expect(meta.property).not.toHaveLength(0);
    }
  });
});

describe('system_prop_map validation', () => {
  const manifest = parseIntegrationManifest(
    runPipeline([readFixtureFile(COMPONENTS, 'system-props.tsx')]).manifest
  );

  test('system_prop_map is populated for used props', () => {
    // Vacuity anchor for the class-name loop in the next test.
    expect(manifest.system_prop_map.p).toBeDefined();
  });

  test('all system_prop_map class name values are animus-u- prefixed', () => {
    for (const [_propName, valueMap] of Object.entries(
      manifest.system_prop_map
    )) {
      for (const className of Object.values(valueMap)) {
        expect(className).toEqual(expect.any(String));
        expect(className).toMatch(/^animus-u-/);
      }
    }
  });
});
