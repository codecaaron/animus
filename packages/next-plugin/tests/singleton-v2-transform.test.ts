import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { engineApi, setSharedEngine } from '../src/singleton';

/** globalThis keys owned by src/singleton.ts — the ESM/CJS shared contract. */
const ENGINE_KEY = '__animus_engine__';
const V2_ENGINE_KEY = '__animus_v2_engine__';
const V2_SENT_SOURCES_KEY = '__animus_v2_sent_sources__';

const g = globalThis as Record<string, unknown>;

let saved: Record<string, unknown>;

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

describe('v2 transformFile adapter', () => {
  test('passes through paths absent from the last analyze() set without calling the engine', () => {
    const calls: string[] = [];
    g[V2_ENGINE_KEY] = {
      transformFile: (p: string) => {
        calls.push(p);
        throw new Error(
          `transformFile('${p}'): path not present in the last analyze() call`
        );
      },
    };
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
    g[V2_ENGINE_KEY] = {
      transformFile: (p: string) => {
        calls.push(p);
        return JSON.stringify({ code: 'transformed', hasComponents: true });
      },
    };
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
