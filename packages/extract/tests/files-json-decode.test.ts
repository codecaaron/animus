import { describe, expect, test } from 'vitest';

import { createEngineApi, parseFilesJson } from '../pipeline';
import { nativeFunctions } from './native-functions';

import type {
  AnalyzeProjectInputs,
  EngineAdapterDeps,
  EngineStateStore,
  ExtractorEngine,
} from '../pipeline';

/** The options the native engine is constructed with. */
type EngineOptions = NonNullable<
  ConstructorParameters<
    ReturnType<EngineAdapterDeps['loadNativeEngine']>['ExtractEngine']
  >[0]
>;
const WELL_FORMED = JSON.stringify([
  { path: 'a.tsx', source: 'export const a = 1;\n' },
  { path: 'b.tsx', source: 'export const b = 2;\n', hash: 'abc' },
]);

describe('parseFilesJson', () => {
  test('returns the entries of a well-formed corpus', () => {
    expect(parseFilesJson(WELL_FORMED, 'test')).toEqual([
      { path: 'a.tsx', source: 'export const a = 1;\n' },
      { path: 'b.tsx', source: 'export const b = 2;\n', hash: 'abc' },
    ]);
  });

  test('keeps keys beyond the entry contract addressable', () => {
    const [entry] = parseFilesJson(
      JSON.stringify([{ path: 'a.tsx', source: '', future: 7 }]),
      'test'
    );
    expect(entry.future).toBe(7);
  });

  test.each([
    ['a JSON object instead of an array', '{"path":"a.tsx","source":""}'],
    ['a bare string', '"a.tsx"'],
    ['an entry with no source', '[{"path":"a.tsx"}]'],
    ['an entry with a non-string path', '[{"path":7,"source":""}]'],
    [
      'an entry with a non-string hash',
      '[{"path":"a.tsx","source":"","hash":7}]',
    ],
    ['a nested array instead of entries', '[["a.tsx",""]]'],
    ['a null entry', '[null]'],
  ])('refuses %s', (_case, payload) => {
    expect(() => parseFilesJson(payload, 'test')).toThrow(TypeError);
  });

  test('names the reader that refused the payload', () => {
    expect(() => parseFilesJson('[{"path":"a.tsx"}]', 'animus-next')).toThrow(
      /\[animus-next\]/
    );
  });

  test('names the wire and reader on malformed JSON', () => {
    expect(() => parseFilesJson('not json', 'test')).toThrow(
      /test filesJson is not valid JSON/
    );
  });
});

function makeStore(): EngineStateStore & { engine: ExtractorEngine | null } {
  let engine: ExtractorEngine | null = null;
  let sentSources: Map<string, string> | null = null;
  let driftWarned = false;
  return {
    get engine() {
      return engine;
    },
    getEngine: () => engine,
    setEngine: (next) => {
      engine = next;
    },
    getSentSources: () => sentSources,
    setSentSources: (sources) => {
      sentSources = sources;
    },
    getDriftWarned: () => driftWarned,
    setDriftWarned: (value) => {
      driftWarned = value;
    },
  };
}

describe('engine adapter analyzeProject', () => {
  test.each([
    ['a corpus that is not an array', '{"path":"a.tsx","source":""}'],
    ['an array of non-entries', '[{"file":"a.tsx"}]'],
  ])('refuses %s before constructing the engine', (_case, filesJson) => {
    const store = makeStore();
    let constructed = 0;
    const api = createEngineApi({
      label: 'adapter-policy-test',
      loadNativeEngine: () => ({
        ...nativeFunctions(),
        ExtractEngine: class {
          constructor() {
            constructed += 1;
          }
          prepare() {
            return '{}';
          }
          analyzePrepared() {
            return '{}';
          }
          fullManifestJson() {
            return '{}';
          }
          analysisTimings() {
            return '{}';
          }
          transformFile() {
            return '{}';
          }
          clearCache() {}
        },
      }),
      store,
    })();

    expect(() =>
      api.analyzeProject({
        filesJson: filesJson,
        scalesJson: '{}',
        variableMapJson: '{}',
        contextualVarsJson: null,
        propConfigJson: '{}',
        groupRegistryJson: '{}',
        packageResolutionJson: '{}',
        devMode: false,
        emitterConfigJson: null,
        selectorAliasesJson: null,
        globalStyleBlocksJson: null,
        pathAliasesJson: null,
        keyframesJson: null,
        staticCssJson: null,
        conditionAliasesJson: null,
        externalDirsJson: null,
        transformSourcesJson: null,
      })
    ).toThrow(/adapter-policy-test/);
    expect(constructed).toBe(0);
    expect(store.engine).toBeNull();
    expect(store.getSentSources()).toBeNull();
  });

  // Contract: an analysis request reaches the engine as its options, each
  // field by name; a null input and an empty optional one are absent, as a
  // persisted request replayed later reads them.
  test('maps a request to the engine options, a null or empty input absent', () => {
    const received: EngineOptions[] = [];
    const api = createEngineApi({
      label: 'adapter-options-test',
      loadNativeEngine: () => ({
        ...nativeFunctions(),
        ExtractEngine: class {
          constructor(options?: EngineOptions) {
            received.push(options ?? {});
          }
          prepare() {
            return '{}';
          }
          analyzePrepared() {
            return '{}';
          }
          fullManifestJson() {
            return '{}';
          }
          analysisTimings() {
            return '{}';
          }
          transformFile() {
            return '{}';
          }
          clearCache() {}
        },
      }),
      store: makeStore(),
    })();
    api.analyzeProject({
      filesJson: '[]',
      scalesJson: 'scales',
      variableMapJson: 'variables',
      contextualVarsJson: 'contextual',
      propConfigJson: 'props',
      groupRegistryJson: 'groups',
      packageResolutionJson: 'packages',
      devMode: true,
      emitterConfigJson: JSON.stringify({
        runtime_import: 'runtime',
        css_module_id: 'css',
        system_props_module_id: 'system-props',
        short_class_prefix: 'x',
        slot_provenance: true,
      }),
      selectorAliasesJson: 'selectors',
      globalStyleBlocksJson: 'globals',
      pathAliasesJson: 'paths',
      keyframesJson: 'keyframes',
      staticCssJson: 'static',
      conditionAliasesJson: 'conditions',
      externalDirsJson: 'external',
      transformSourcesJson: 'transforms',
      transformProvenanceJson: 'provenance',
      declarationScalesJson: 'declarations',
      analysisContextJson: 'context',
      generatedNamesJson: 'names',
      propertyRecordsJson: 'properties',
      positionTryJson: 'tries',
      viewTransitionsJson: 'transitions',
    });
    api.analyzeProject({
      filesJson: '[]',
      scalesJson: 'scales',
      variableMapJson: 'variables',
      contextualVarsJson: null,
      propConfigJson: 'props',
      groupRegistryJson: 'groups',
      packageResolutionJson: 'packages',
      devMode: false,
      emitterConfigJson: null,
      selectorAliasesJson: null,
      globalStyleBlocksJson: null,
      pathAliasesJson: null,
      keyframesJson: null,
      staticCssJson: null,
      conditionAliasesJson: null,
      externalDirsJson: null,
      transformSourcesJson: null,
      transformProvenanceJson: null,
      declarationScalesJson: '',
      analysisContextJson: '',
      generatedNamesJson: '',
      propertyRecordsJson: '',
      positionTryJson: '',
      viewTransitionsJson: '',
    });
    expect(received[0]).toEqual({
      runtimeImport: 'runtime',
      cssModuleId: 'css',
      systemPropsModuleId: 'system-props',
      themeJson: 'scales',
      variableMapJson: 'variables',
      contextualVarsJson: 'contextual',
      configJson: 'props',
      groupRegistryJson: 'groups',
      selectorAliasesJson: 'selectors',
      conditionAliasesJson: 'conditions',
      globalStyleBlocksJson: 'globals',
      keyframesJson: 'keyframes',
      packageResolutionJson: 'packages',
      pathAliasesJson: 'paths',
      staticCssJson: 'static',
      externalDirsJson: 'external',
      transformSourcesJson: 'transforms',
      transformProvenanceJson: 'provenance',
      declarationScalesJson: 'declarations',
      analysisContextJson: 'context',
      generatedNamesJson: 'names',
      propertyRecordsJson: 'properties',
      positionTryJson: 'tries',
      viewTransitionsJson: 'transitions',
      shortClassPrefix: 'x',
      slotProvenance: true,
      devMode: true,
    });
    const present = Object.entries(received[1]!).filter(
      ([, value]) => value !== undefined
    );
    expect(Object.fromEntries(present)).toEqual({
      themeJson: 'scales',
      variableMapJson: 'variables',
      configJson: 'props',
      groupRegistryJson: 'groups',
      packageResolutionJson: 'packages',
      devMode: false,
    });
  });

  // Contract: the request is read once, as the call receives it: what
  // rehydration or a getter changes afterwards never reaches the engine.
  test('reads each request field once, before rehydration', () => {
    const request = (): AnalyzeProjectInputs => ({
      filesJson: '[]',
      scalesJson: '{}',
      variableMapJson: '{}',
      contextualVarsJson: null,
      propConfigJson: '{}',
      groupRegistryJson: '{}',
      packageResolutionJson: '{}',
      devMode: false,
      emitterConfigJson: null,
      selectorAliasesJson: null,
      globalStyleBlocksJson: null,
      pathAliasesJson: null,
      keyframesJson: null,
      staticCssJson: null,
      conditionAliasesJson: null,
      externalDirsJson: null,
      transformSourcesJson: null,
    });
    const received: EngineOptions[] = [];
    const analyze = (
      inputs: AnalyzeProjectInputs,
      rehydrateFilesJson = (filesJson: string) => filesJson
    ) =>
      createEngineApi({
        label: 'adapter-snapshot-test',
        loadNativeEngine: () => ({
          ...nativeFunctions(),
          ExtractEngine: class {
            constructor(options?: EngineOptions) {
              received.push(options ?? {});
            }
            prepare() {
              return '{}';
            }
            analyzePrepared() {
              return '{}';
            }
            fullManifestJson() {
              return '{}';
            }
            analysisTimings() {
              return '{}';
            }
            transformFile() {
              return '{}';
            }
            clearCache() {}
          },
        }),
        store: makeStore(),
        rehydrateFilesJson,
      })().analyzeProject(inputs);

    const mutated = request();
    analyze(mutated, (filesJson) => {
      mutated.devMode = true;
      return filesJson;
    });
    expect(received[0]?.devMode).toBe(false);

    const changing = request();
    let reads = 0;
    Object.defineProperty(changing, 'emitterConfigJson', {
      enumerable: true,
      get: () => {
        reads += 1;
        return JSON.stringify({
          runtime_import: reads === 1 ? 'first' : 'second',
        });
      },
    });
    analyze(changing);
    expect(received[1]?.runtimeImport).toBe('first');
    expect(reads).toBe(1);
  });
});
