/**
 * `filesJson` decode policy.
 *
 * The serialized analysis corpus is animus's OWN wire — this package writes it
 * and every reader is in this repository — so a payload that is not an entry
 * array is a producer bug. One decoder (`parseFilesJson`) owns that judgement
 * for all three readers, and its policy is to THROW: a silently-empty corpus is
 * indistinguishable from "the project has no files" and would let a build
 * publish an empty stylesheet as a success.
 *
 * The adapter case is the one that used to differ: it cast the parsed value
 * without looking, so a malformed corpus reached the engine as an empty
 * drift-tracking map instead of a failure.
 */
import { describe, expect, test } from 'vitest';

import { createV2EngineApi, parseFilesJson } from '../pipeline';

import type { V2EngineStateStore, V2ExtractEngine } from '../pipeline';

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

  test('lets a JSON syntax error surface unchanged', () => {
    expect(() => parseFilesJson('not json', 'test')).toThrow(SyntaxError);
  });
});

/** A store whose engine slot is observable — the assertion below is that a
 *  refused corpus never reaches engine construction. */
function makeStore(): V2EngineStateStore & { engine: V2ExtractEngine | null } {
  let engine: V2ExtractEngine | null = null;
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
    // The silent case: an array whose members are not source entries used to
    // pass straight through, seeding the drift map with undefined keys.
    ['an array of non-entries', '[{"file":"a.tsx"}]'],
  ])('refuses %s before constructing the engine', (_case, filesJson) => {
    const store = makeStore();
    let constructed = 0;
    const api = createV2EngineApi({
      label: 'adapter-policy-test',
      isV2: () => true,
      loadNativeEngine: () => ({
        ExtractEngine: class {
          constructor() {
            constructed += 1;
          }
          analyze() {
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
      api.analyzeProject(
        filesJson,
        '{}',
        '{}',
        null,
        '{}',
        '{}',
        '{}',
        false,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null
      )
    ).toThrow(/adapter-policy-test/);
    expect(constructed).toBe(0);
    expect(store.engine).toBeNull();
    expect(store.getSentSources()).toBeNull();
  });
});
