import { isJsonObject, isJsonString } from '@animus-ui/assertions';
import { join } from 'node:path';
/**
 * Manifest shape + completeness assertions.
 *
 * Covers the `manifest-completeness-testing` capability from the
 * integration-test-infrastructure change. Validates the structural shape and
 * internal consistency of the manifest returned by `analyzeProject()`.
 *
 * This suite is ALSO the tether for `ProjectManifest`
 * (`@animus-ui/extract/pipeline`): that declaration mirrors a Rust struct, so
 * nothing in TypeScript can keep it honest. Here the mirror is checked against
 * a REAL engine manifest at runtime — the decoder below narrows to the owner's
 * own types, so a Rust-side rename, a spelling change, or a field that stops
 * being emitted fails this file instead of rotting the declaration silently.
 * Types are the vocabulary here, never the proof: the checks stay.
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

/** The manifest slice this suite decodes — the owner's declaration, sliced,
 *  never restated. Every field here is required because the producer emits
 *  every one of them unconditionally; that is exactly the claim under test. */
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

/** The splittable layers a fragment record may carry. Named here because the
 *  record is keyed, not open: an unexpected key means the emitter grew a layer
 *  this suite has never seen. `satisfies` ties the list to the owner type, so a
 *  renamed or dropped layer fails to compile rather than silently widening the
 *  check. */
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
  // Every field is read unconditionally: the producer emits all of them for
  // every universe (empty ones as `{}`), so an absent field is a contract
  // break the decoder must surface, not default away.
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
    expect(manifest.components).toEqual(expect.any(Object));
    expect(Object.keys(manifest.components).length).toBeGreaterThan(0);
  });

  test('every component descriptor has required non-empty fields', () => {
    for (const [id, descriptor] of Object.entries(manifest.components)) {
      expect(descriptor.file).toEqual(expect.any(String));
      expect(descriptor.file.length).toBeGreaterThan(0);
      expect(descriptor.binding).toEqual(expect.any(String));
      expect(descriptor.binding.length).toBeGreaterThan(0);
      expect(descriptor.class_name).toEqual(expect.any(String));
      expect(descriptor.class_name).toMatch(/^animus-/);
      expect(descriptor.replacement).toEqual(expect.any(String));
      expect(descriptor.replacement.length).toBeGreaterThan(0);
      expect(descriptor.tag).toEqual(expect.any(String));
      expect(descriptor.tag.length).toBeGreaterThan(0);
      expect(Object.prototype.toString.call(descriptor.terminal)).toBe(
        '[object String]'
      );
      expect(descriptor.terminal.length).toBeGreaterThan(0);
      // id should be a non-empty string and match the key
      expect(id.length).toBeGreaterThan(0);
    }
  });
});

describe('files-to-components consistency', () => {
  const manifest = parseIntegrationManifest(
    runPipeline(readFixtureFiles(COMPONENTS)).manifest
  );

  test('every component_id in manifest.files exists in manifest.components', () => {
    expect(manifest.files).toEqual(expect.any(Object));
    for (const [filePath, componentIds] of Object.entries(manifest.files)) {
      expect(Array.isArray(componentIds)).toBe(true);
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
    expect(reverse).toEqual(expect.any(Object));
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

    // Unconditional: a fragment record only exists for a component that
    // produced CSS. (A `bailed` skip used to guard this loop; the emitter has
    // no such field, so the guard never fired — the check is the same one,
    // now without a condition that could never be true.)
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
    // button.tsx uses only static literal values → no dynamic props expected.
    const dp = manifest.dynamic_props;
    expect(Object.keys(dp).length).toBe(0);
  });

  test('dynamic prop entries carry required metadata', () => {
    const manifest = parseIntegrationManifest(
      runPipeline(readFixtureFiles(COMPONENTS)).manifest
    );
    const dp = manifest.dynamic_props;
    for (const [_propName, meta] of Object.entries(dp)) {
      // v2 emits dynamic_props metadata with camelCase keys (varName/slotClass);
      // v1 used snake_case (var_name/slot_class). The metadata contract itself
      // is unchanged.
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
    expect(manifest.system_prop_map).toEqual(expect.any(Object));
    // system-props.tsx uses p, mt, display, color — at minimum p and mt should appear.
    expect(manifest.system_prop_map.p).toBeDefined();
    expect(manifest.system_prop_map.p).toEqual(expect.any(Object));
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
