import { AnimusConfigError } from '@animus-ui/extract/pipeline';
import { TURBOPACK_SYSTEM_PROPS_ID } from '@animus-ui/extract/session';
import { sep } from 'node:path';
import { describe, expect, test } from 'vitest';

// State mutator deliberately OFF the public barrel — tests reach it via
// source (the next-plugin test convention).
import {
  claimExclusiveSessionOwner as claimProcessHost,
  setSessionArtifactDir,
} from '../../extract/session/singleton';
import {
  createHostState,
  disposeSessionDir,
  drivePipeline,
  PROPS_VIRTUAL_ID,
  resolveAnimusId,
  shouldClaimTransform,
  STYLES_VIRTUAL_ID,
  substituteDevDefine,
  transformWithEngine,
} from '../src/core';
import {
  resolveHostMode,
  resolveHostOptions,
  type AnimusUnpluginOptions,
} from '../src/options';

interface RuntimeHostOptionMap {
  exclide: never[];
  mode: 'prod';
  engine: 'v1';
}

function withRuntimeHostOption<Key extends keyof RuntimeHostOptionMap>(
  key: Key,
  value: RuntimeHostOptionMap[Key]
): AnimusUnpluginOptions {
  const options: AnimusUnpluginOptions = { system: './ds.ts' };
  Object.defineProperty(options, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
  return options;
}

describe('option validation', () => {
  test('missing system is a config error naming the remedy', () => {
    expect(() => resolveHostOptions(undefined, '/tmp')).toThrow(
      /Missing required option `system`/
    );
  });

  test('unknown top-level keys fail loud naming the key', () => {
    expect(() =>
      resolveHostOptions(withRuntimeHostOption('exclide', []), '/tmp')
    ).toThrow(/Unknown option "exclide"/);
  });

  test('invalid mode values fail loud at intake', () => {
    expect(() =>
      resolveHostOptions(withRuntimeHostOption('mode', 'prod'), '/tmp')
    ).toThrow(/Invalid mode "prod"/);
  });

  test('a retired engine selection is rejected, never upgraded', () => {
    expect(() =>
      resolveHostOptions(withRuntimeHostOption('engine', 'v1'), '/tmp')
    ).toThrow(/v1/);
  });

  test('config errors carry the shared AnimusConfigError class', () => {
    try {
      resolveHostOptions(undefined, '/tmp');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AnimusConfigError);
    }
  });

  test('root resolves against cwd; default IS cwd (the host honors root)', () => {
    const cwd = `${sep}consumer${sep}app`;
    expect(resolveHostOptions({ system: './ds.ts' }, cwd).root).toBe(cwd);
    expect(
      resolveHostOptions({ system: './ds.ts', root: 'packages/web' }, cwd).root
    ).toBe(`${cwd}${sep}packages${sep}web`);
  });
});

describe('mode resolution (explicit > bundler oracle > production)', () => {
  test('explicit mode wins over every bundler signal', () => {
    expect(resolveHostMode('production', 'development')).toBe('production');
    expect(resolveHostMode('development', 'production')).toBe('development');
  });

  test('the bundler command oracle applies when mode is absent', () => {
    expect(resolveHostMode(undefined, 'development')).toBe('development');
  });

  test('the documented default is production — never NODE_ENV', () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      expect(resolveHostMode(undefined, null)).toBe('production');
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});

describe('id resolution (constant mapping; kit redirects are the pipeline-gated second step)', () => {
  test('the emitted stylesheet id resolves, exact and suffixed', () => {
    expect(resolveAnimusId('.animus/styles.css')).toBe(STYLES_VIRTUAL_ID);
    expect(resolveAnimusId('/consumer/app/.animus/styles.css')).toBe(
      STYLES_VIRTUAL_ID
    );
  });

  test('the system-props id resolves to its virtual module', () => {
    expect(resolveAnimusId(TURBOPACK_SYSTEM_PROPS_ID)).toBe(PROPS_VIRTUAL_ID);
  });

  test('resolved virtual ids re-resolve to themselves', () => {
    expect(resolveAnimusId(STYLES_VIRTUAL_ID)).toBe(STYLES_VIRTUAL_ID);
    expect(resolveAnimusId(PROPS_VIRTUAL_ID)).toBe(PROPS_VIRTUAL_ID);
  });

  test('bare and unrelated ids fall through (kit lookup is not this seam)', () => {
    expect(resolveAnimusId('@acme/kit')).toBeNull();
    expect(resolveAnimusId('react')).toBeNull();
    expect(resolveAnimusId('./Button')).toBeNull();
  });
});

describe('dev-signal define substitution (bundlers without native define)', () => {
  test('the bare token becomes its boolean literal', () => {
    expect(
      substituteDevDefine(
        "typeof __ANIMUS_DEV__ === 'boolean' ? __ANIMUS_DEV__ : fallback()",
        false
      )
    ).toBe("typeof false === 'boolean' ? false : fallback()");
    expect(substituteDevDefine('if (__ANIMUS_DEV__) log()', true)).toBe(
      'if (true) log()'
    );
  });

  test('assignments are left alone (preventAssignment)', () => {
    expect(substituteDevDefine('__ANIMUS_DEV__ = true;', false)).toBe(
      '__ANIMUS_DEV__ = true;'
    );
  });

  test('token-free code returns null (no rewrite)', () => {
    expect(substituteDevDefine('const x = 1;', false)).toBeNull();
  });
});

describe('transform delegation', () => {
  test('delegates with the rootDir-relative posix key and the manifest', () => {
    const calls: Array<[string, string, string]> = [];
    const result = transformWithEngine('src', '/app/src/Button.tsx', {
      rootDir: '/app',
      manifestJson: '{"components":{}}',
      transformFile: (source, path, manifest) => {
        calls.push([source, path, manifest]);
        return { code: 'out', hasComponents: true };
      },
    });
    expect(result).toBe('out');
    expect(calls).toEqual([['src', 'src/Button.tsx', '{"components":{}}']]);
  });

  test('external kit sources keep the ../ analysis key derivation', () => {
    let seen = '';
    transformWithEngine('src', '/repo/packages/kit/src/index.ts', {
      rootDir: '/repo/e2e/app',
      manifestJson: '',
      transformFile: (_source, path) => {
        seen = path;
        return { code: '', hasComponents: false };
      },
    });
    expect(seen).toBe('../../packages/kit/src/index.ts');
  });

  test('component-free files return null (source passes through unchanged)', () => {
    expect(
      transformWithEngine('const x = 1;', '/app/src/util.ts', {
        rootDir: '/app',
        manifestJson: '',
        transformFile: (source) => ({ code: source, hasComponents: false }),
      })
    ).toBeNull();
  });

  test('missing engine state fails the transform loud — never a passthrough', () => {
    expect(() =>
      transformWithEngine('src', '/app/src/Button.tsx', {
        rootDir: '/app',
        manifestJson: '',
        transformFile: () => {
          throw new Error('v2 transform before analyze');
        },
      })
    ).toThrow(/transform before analyze/);
  });
});

describe('session-dir cleanup', () => {
  test('a failed pipeline disposes the session dir before rethrowing — REAL ordering: the dir is NOT yet recorded on state at throw time', async () => {
    // Production assigns state.sessionDir only AFTER the pipeline await
    // resolves; on failure it is still null and the dir is recoverable
    // only from the session singleton (which publishes it at pipeline
    // START). The first version of this test assigned state.sessionDir
    // inside the fake — masking exactly the leak it existed to prevent
    // (inc 05 review B1). This version fails against the pre-fix code.
    const state = createHostState();
    const removed: string[] = [];
    setSessionArtifactDir('/tmp/animus-session-from-singleton');
    try {
      await expect(
        drivePipeline(
          state,
          async () => {
            // state.sessionDir deliberately NOT assigned — the real
            // failure-path shape.
            throw new Error('analysis failed');
          },
          (dir) => removed.push(dir)
        )
      ).rejects.toThrow('analysis failed');
    } finally {
      setSessionArtifactDir('');
    }
    expect(removed).toEqual(['/tmp/animus-session-from-singleton']);
    expect(state.sessionDir).toBeNull();
  });

  test('a successful pipeline leaves disposal to the build-end path', async () => {
    const state = createHostState();
    const removed: string[] = [];
    await drivePipeline(
      state,
      async () => {
        state.sessionDir = '/tmp/animus-session';
      },
      (dir) => removed.push(dir)
    );
    expect(removed).toEqual([]);
    expect(state.sessionDir).toBe('/tmp/animus-session');
  });

  test('disposal is idempotent', () => {
    const state = createHostState();
    const removed: string[] = [];
    state.sessionDir = '/tmp/animus-session';
    disposeSessionDir(state, (dir) => removed.push(dir));
    disposeSessionDir(state, (dir) => removed.push(dir));
    expect(removed).toEqual(['/tmp/animus-session']);
  });
});

describe('transform claim (node_modules skip)', () => {
  const claimState = {
    externalPackageDirs: ['/app/node_modules/@kit/ds'],
    redirectTargets: new Set(['/app/node_modules/@kit/ds/src/index.tsx']),
  };

  test('project sources are always claimed', () => {
    expect(shouldClaimTransform('/app/src/Button.tsx', claimState)).toBe(true);
  });

  test('dependency-graph node_modules files are NOT claimed', () => {
    // The regression this pins: without the exclusion every module in
    // node_modules (react, lodash, …) rode through joinPipeline + a NAPI
    // transform round trip, scaling build time with dependency-graph size.
    expect(
      shouldClaimTransform('/app/node_modules/react/index.js', claimState)
    ).toBe(false);
    expect(
      shouldClaimTransform('/app/node_modules/lodash/map.js', claimState)
    ).toBe(false);
  });

  test('admitted external package files ARE claimed (kit chains must rewrite)', () => {
    expect(
      shouldClaimTransform(
        '/app/node_modules/@kit/ds/src/Badge.tsx',
        claimState
      )
    ).toBe(true);
    expect(
      shouldClaimTransform(
        '/app/node_modules/@kit/ds/src/index.tsx',
        claimState
      )
    ).toBe(true);
  });

  test('a sibling package under the same scope is not claimed by prefix accident', () => {
    expect(
      shouldClaimTransform(
        '/app/node_modules/@kit/ds-icons/src/index.tsx',
        claimState
      )
    ).toBe(false);
  });
});

// The claim itself now lives on the session (ExtractionSession.runFullPipeline
// claims, close() releases); these pin the mechanism the host inherits.
describe('process publication claim (one live publisher per process)', () => {
  test('sequential claim/release cycles are legal', () => {
    const releaseA = claimProcessHost('animus-host:/app');
    releaseA();
    const releaseB = claimProcessHost('animus-host:/app');
    releaseB();
  });

  test('a concurrent second host fails loud naming both hosts and the remedy', () => {
    const release = claimProcessHost('animus-host:/app-client');
    try {
      expect(() => claimProcessHost('animus-host:/app-server')).toThrow(
        /app-client.*process-global|process-global.*app-client/s
      );
      expect(() => claimProcessHost('animus-host:/app-server')).toThrow(
        /sequential/i
      );
    } finally {
      release();
    }
    // Released: the next claim succeeds again.
    claimProcessHost('animus-host:/app-server')();
  });

  test('release is scoped to its own claim (a stale release cannot free a successor)', () => {
    const releaseA = claimProcessHost('animus-host:/a');
    releaseA();
    const releaseB = claimProcessHost('animus-host:/b');
    // A's release handle fired again after B claimed must NOT free B.
    releaseA();
    expect(() => claimProcessHost('animus-host:/c')).toThrow(/still active/);
    releaseB();
  });
});
