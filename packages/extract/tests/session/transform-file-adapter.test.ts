import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { engineApi, setSharedEngine } from '../../session/singleton';

import type { V2ExtractEngine } from '../../pipeline';
import type { AnimusEngine } from '../../session/singleton';

const ENGINE_KEY = '__animus_engine__';
const V2_ENGINE_KEY = '__animus_v2_engine__';
const V2_SENT_SOURCES_KEY = '__animus_v2_sent_sources__';

interface V2AdapterSlots {
  [ENGINE_KEY]: AnimusEngine | undefined;
  [V2_ENGINE_KEY]: V2ExtractEngine | null;
  [V2_SENT_SOURCES_KEY]: Map<string, string> | null | undefined;
}

// SAFETY: the session singleton is the sole owner of these three globalThis
// keys and declares exactly these value types; afterEach restores each one.
const g = globalThis as typeof globalThis & V2AdapterSlots;

let saved: V2AdapterSlots;

function transformOnlyEngine(
  transformFile: V2ExtractEngine['transformFile']
): V2ExtractEngine {
  return {
    transformFile,
    analyze: () => {
      throw new Error('analyze() must not run during a transform');
    },
    clearCache: () => {
      throw new Error('clearCache() must not run during a transform');
    },
  };
}

beforeEach(() => {
  saved = {
    [ENGINE_KEY]: g[ENGINE_KEY],
    [V2_ENGINE_KEY]: g[V2_ENGINE_KEY],
    [V2_SENT_SOURCES_KEY]: g[V2_SENT_SOURCES_KEY],
  };
  setSharedEngine('v2');
});

afterEach(() => {
  Object.assign(g, saved);
});

describe('engineApi transformFile adapter', () => {
  test('passes through paths absent from the last analyze() set without calling the engine', () => {
    const calls: string[] = [];
    g[V2_ENGINE_KEY] = transformOnlyEngine((p) => {
      calls.push(p);
      throw new Error(
        `transformFile('${p}'): path not present in the last analyze() call`
      );
    });
    g[V2_SENT_SOURCES_KEY] = new Map([['src/analyzed.tsx', 'const a = 1;']]);

    const source = 'export const systemPropMap = {};\n';
    const result = engineApi().transformFile(
      source,
      '.animus/system-props.js',
      '{}'
    );

    expect(result).toEqual({ code: source, hasComponents: false });
    expect(calls).toEqual([]);
  });

  test('still transforms paths that were part of the analyze() set', () => {
    const calls: string[] = [];
    g[V2_ENGINE_KEY] = transformOnlyEngine((p) => {
      calls.push(p);
      return JSON.stringify({ code: 'transformed', hasComponents: true });
    });
    const source = 'const a = 1;';
    g[V2_SENT_SOURCES_KEY] = new Map([['src/analyzed.tsx', source]]);

    const result = engineApi().transformFile(source, 'src/analyzed.tsx', '{}');

    expect(result).toEqual({ code: 'transformed', hasComponents: true });
    expect(calls).toEqual(['src/analyzed.tsx']);
  });

  test('fails loud when the engine instance is missing', () => {
    g[V2_ENGINE_KEY] = null;
    g[V2_SENT_SOURCES_KEY] = new Map([['src/analyzed.tsx', 'const a = 1;']]);

    expect(() =>
      engineApi().transformFile('src', 'src/analyzed.tsx', '{}')
    ).toThrow(/v2 transform before analyze/);
  });
});
