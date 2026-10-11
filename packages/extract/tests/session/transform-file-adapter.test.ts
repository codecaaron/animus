import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { engineApi, joinSession, sessionKey } from '../../session/singleton';
import { resetAnimusGlobals } from './session-fixtures';

import type { V2ExtractEngine } from '../../pipeline';
import type { SessionKey, SessionState } from '../../session/singleton';

let restoreGlobals: () => void;
let key: SessionKey;
let state: SessionState;

function transformOnlyEngine(
  transformFile: V2ExtractEngine['transformFile']
): V2ExtractEngine {
  return {
    transformFile,
    prepare: () => {
      throw new Error('prepare() must not run during a transform');
    },
    analyze: () => {
      throw new Error('analyze() must not run during a transform');
    },
    clearCache: () => {
      throw new Error('clearCache() must not run during a transform');
    },
  };
}

beforeEach(() => {
  restoreGlobals = resetAnimusGlobals();
  key = sessionKey('adapter-build', '/adapter-root');
  state = joinSession(key, 'adapter-test', { system: './src/system.ts' });
});

afterEach(() => {
  restoreGlobals();
});

describe('engineApi transformFile adapter', () => {
  test('passes through paths absent from the last analyze() set without calling the engine', () => {
    const calls: string[] = [];
    state.engine = transformOnlyEngine((p) => {
      calls.push(p);
      throw new Error(
        `transformFile('${p}'): path not present in the last analyze() call`
      );
    });
    state.sentSources = new Map([['src/analyzed.tsx', 'const a = 1;']]);

    const source = 'export const systemPropMap = {};\n';
    const result = engineApi(key).transformFile(
      source,
      '.animus/system-props.js',
      '{}'
    );

    expect(result).toEqual({ code: source, hasComponents: false });
    expect(calls).toEqual([]);
  });

  test('still transforms paths that were part of the analyze() set', () => {
    const calls: string[] = [];
    state.engine = transformOnlyEngine((p) => {
      calls.push(p);
      return JSON.stringify({ code: 'transformed', hasComponents: true });
    });
    const source = 'const a = 1;';
    state.sentSources = new Map([['src/analyzed.tsx', source]]);

    const result = engineApi(key).transformFile(
      source,
      'src/analyzed.tsx',
      '{}'
    );

    expect(result).toEqual({ code: 'transformed', hasComponents: true });
    expect(calls).toEqual(['src/analyzed.tsx']);
  });

  test('fails loud when the engine instance is missing', () => {
    state.engine = null;
    state.sentSources = new Map([['src/analyzed.tsx', 'const a = 1;']]);

    expect(() =>
      engineApi(key).transformFile('src', 'src/analyzed.tsx', '{}')
    ).toThrow(/v2 transform before analyze/);
  });
});
