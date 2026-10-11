import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  engineApi,
  EnvironmentFailure,
  joinSession,
  leaveSession,
  sessionKey,
  setEngineFactoryLoaderForTests,
} from '../../session/singleton';
import { resetAnimusGlobals } from './session-fixtures';

import type { V2ExtractEngine } from '../../pipeline';
import type { SessionKey } from '../../session/singleton';

let restoreGlobals: () => void;
let key: SessionKey;

/** A native module whose engine only transforms: an analyze returns an
 *  empty manifest, so the store records the sent sources and nothing else. */
function nativeTransformingWith(
  transformFile: V2ExtractEngine['transformFile']
) {
  return {
    ExtractEngine: class {
      prepare(): string {
        throw new Error('prepare() must not run during a transform');
      }
      analyze(): string {
        return '{}';
      }
      transformFile(path: string): string {
        return transformFile(path);
      }
      clearCache(): void {
        throw new Error('clearCache() must not run during a transform');
      }
    },
  };
}

/** The build's engine analyzes `files`, as a pipeline run would. */
function analyze(files: Array<[string, string]>): void {
  engineApi(key).analyzeProject(
    JSON.stringify(files.map(([path, source]) => ({ path, source }))),
    '{}',
    '{}',
    null,
    '{}',
    '{}',
    '{}',
    false,
    '{}'
  );
}

beforeEach(() => {
  restoreGlobals = resetAnimusGlobals();
  key = sessionKey('adapter-build', '/adapter-root');
  joinSession(key, 'adapter-test', { system: './src/system.ts' });
});

afterEach(() => {
  setEngineFactoryLoaderForTests(null);
  restoreGlobals();
});

describe('engineApi transformFile adapter', () => {
  test('passes through paths absent from the last analyze() set without calling the engine', () => {
    const calls: string[] = [];
    setEngineFactoryLoaderForTests(() =>
      nativeTransformingWith((p) => {
        calls.push(p);
        throw new Error(
          `transformFile('${p}'): path not present in the last analyze() call`
        );
      })
    );
    analyze([['src/analyzed.tsx', 'const a = 1;']]);

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
    setEngineFactoryLoaderForTests(() =>
      nativeTransformingWith((p) => {
        calls.push(p);
        return JSON.stringify({ code: 'transformed', hasComponents: true });
      })
    );
    const source = 'const a = 1;';
    analyze([['src/analyzed.tsx', source]]);

    const result = engineApi(key).transformFile(
      source,
      'src/analyzed.tsx',
      '{}'
    );

    expect(result).toEqual({ code: 'transformed', hasComponents: true });
    expect(calls).toEqual(['src/analyzed.tsx']);
  });

  test('fails loud when the engine instance is missing', () => {
    setEngineFactoryLoaderForTests(() =>
      nativeTransformingWith(() => {
        throw new Error('no engine was made');
      })
    );

    expect(() =>
      engineApi(key).transformFile('src', 'src/analyzed.tsx', '{}')
    ).toThrow(/v2 transform before analyze/);
  });
});

describe('the one engine-handle store', () => {
  /** Contract: a native load failure is an EnvironmentFailure (SA18), and
   *  never answered by another engine. It is not cached: a later use loads
   *  again. */
  test('a native load failure is an EnvironmentFailure', () => {
    const missing = new Error('dlopen: animus-extract-v2.node not found');
    setEngineFactoryLoaderForTests(() => {
      throw missing;
    });

    let thrown: unknown;
    try {
      engineApi(key);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(EnvironmentFailure);
    expect(thrown).toMatchObject({
      code: 'EnvironmentFailure',
      cause: missing,
    });

    setEngineFactoryLoaderForTests(() => nativeTransformingWith(() => '{}'));
    expect(() => engineApi(key)).not.toThrow();
  });

  /** Contract: a build's engine state goes with it. A retired build joined
   *  again under its key starts from a fresh engine. */
  test('a retired build releases its engine state', () => {
    setEngineFactoryLoaderForTests(() =>
      nativeTransformingWith(() =>
        JSON.stringify({ code: 'transformed', hasComponents: true })
      )
    );
    analyze([['src/analyzed.tsx', 'const a = 1;']]);
    leaveSession(key, 'adapter-test');
    joinSession(key, 'adapter-test', { system: './src/system.ts' });

    expect(() =>
      engineApi(key).transformFile('const a = 1;', 'src/analyzed.tsx', '{}')
    ).toThrow(/v2 transform before analyze/);
  });
});
