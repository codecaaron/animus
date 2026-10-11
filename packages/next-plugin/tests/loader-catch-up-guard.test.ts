import { contentHash } from '@animus-ui/extract/pipeline';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  replacementEpochPath,
  sessionArtifactDir,
} from '../../extract/session/session-paths';
import {
  engineApi,
  joinSession,
  sessionKey,
  setEngineFactoryLoaderForTests,
} from '../../extract/session/singleton';
import {
  disposeTempRoots,
  makeTempRoot,
  resetAnimusGlobals,
} from '../../extract/tests/session/session-fixtures';
import animusLoader from '../src/loader';

import type { SessionState } from '../../extract/session/singleton';
import type { V2ExtractEngine } from '@animus-ui/extract/pipeline';

const SESSION_ID = 'loader-epoch-session';

let restoreGlobals: () => void;
/** The build of the test's root, which `createRoot` joins. */
let state: SessionState;

/** A native module whose engine analyzed nothing and is never called for
 *  a path outside that analysis. */
const unreachableNative = {
  ExtractEngine: class implements V2ExtractEngine {
    prepare(): string {
      throw new Error('engine must not be called for unknown paths');
    }
    analyze(): string {
      return '{}';
    }
    transformFile(): string {
      throw new Error('engine must not be called for unknown paths');
    }
    clearCache(): void {
      throw new Error('engine must not be called for unknown paths');
    }
  },
};

const OLD_SOURCE = 'export const x = 1;\n';
const NEW_SOURCE =
  "export const C = animus.styles({ margin: 8 }).asElement('div');\n";

beforeEach(() => {
  restoreGlobals = resetAnimusGlobals();
});

afterEach(() => {
  setEngineFactoryLoaderForTests(null);
  restoreGlobals();
  disposeTempRoots();
});

function createRoot(withArtifact: boolean) {
  const root = makeTempRoot('animus-loader-epoch-');
  const sessionDir = sessionArtifactDir(root, SESSION_ID);
  state = joinSession(sessionKey(SESSION_ID, root), 'animus-next', {
    system: './src/ds.ts',
  });
  state.manifestJson = JSON.stringify({ components: {} });
  setEngineFactoryLoaderForTests(() => unreachableNative);
  // An analysis of no files: every path the loader sees is outside it.
  engineApi(sessionKey(SESSION_ID, root)).analyzeProject(
    '[]',
    '{}',
    '{}',
    null,
    '{}',
    '{}',
    '{}',
    false,
    '{}'
  );
  state.artifactDir = sessionDir;
  const epochPath = replacementEpochPath(sessionDir);
  if (withArtifact) {
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      epochPath,
      JSON.stringify({ schema: 1, sessionId: SESSION_ID, epoch: 'e0' })
    );
  }
  return { root, epochPath };
}

function runLoader(args: {
  root: string;
  relPath?: string;
  source: string;
  mode?: 'development' | 'production' | 'none';
}) {
  const dependencies: string[] = [];
  const ctx = {
    resourcePath: join(args.root, args.relPath ?? 'src/C.tsx'),
    rootContext: args.root,
    getOptions: () => ({ build: SESSION_ID, root: args.root }),
    addDependency: (file: string) => {
      dependencies.push(file);
    },
    mode: args.mode ?? ('development' as const),
  };
  const output = animusLoader.call(ctx, args.source);
  return { output, dependencies };
}

describe('replacements-epoch artifact registered as a file dependency (design D2)', () => {
  test('every dev invocation registers the session-scoped artifact, transform-eligible, passthrough and manifest-absent alike', () => {
    const { root, epochPath } = createRoot(true);

    expect(runLoader({ root, source: OLD_SOURCE }).dependencies).toEqual([
      epochPath,
    ]);

    // Without an analysis the module fails rather than serve raw (SA1),
    // having registered the artifact first.
    state.manifestJson = null;
    const dependencies: string[] = [];
    expect(() =>
      animusLoader.call(
        {
          resourcePath: join(root, 'src/C.tsx'),
          rootContext: root,
          getOptions: () => ({ build: SESSION_ID, root }),
          addDependency: (file: string) => {
            dependencies.push(file);
          },
          mode: 'development' as const,
        },
        OLD_SOURCE
      )
    ).toThrow(/no analysis is available/);
    expect(dependencies).toEqual([epochPath]);
  });

  test('no dependency when the artifact does not exist', () => {
    const { root } = createRoot(false);
    expect(runLoader({ root, source: OLD_SOURCE }).dependencies).toEqual([]);
  });

  test('no dependency when no owning session published a session dir', () => {
    const { root } = createRoot(true);
    state.artifactDir = null;
    expect(runLoader({ root, source: OLD_SOURCE }).dependencies).toEqual([]);
  });

  test('production invocations register the artifact too, so a rebuild never restores a transform from a disagreeing analysis', () => {
    const { root, epochPath } = createRoot(true);
    const { output, dependencies } = runLoader({
      root,
      source: OLD_SOURCE,
      mode: 'production',
    });
    expect(output).toBe(OLD_SOURCE);
    expect(dependencies).toEqual([epochPath]);
  });
});

describe('unconditional analyzed-content-hash guard (design D4)', () => {
  test('an analyzed file whose source hash moved fails with ANIMUS_ANALYSIS_CATCHING_UP', () => {
    const { root } = createRoot(true);
    state.analyzedHashes = new Map([['src/C.tsx', contentHash(OLD_SOURCE)]]);
    expect(() => runLoader({ root, source: NEW_SOURCE })).toThrow(
      /ANIMUS_ANALYSIS_CATCHING_UP: src\/C\.tsx/
    );
  });

  test('zero-entries→first-chain: a file analyzed with no animus entries is never published raw after gaining its first chain', () => {
    const { root } = createRoot(true);
    state.manifestJson = JSON.stringify({ components: {} });
    state.analyzedHashes = new Map([['src/C.tsx', contentHash(OLD_SOURCE)]]);
    expect(() => runLoader({ root, source: NEW_SOURCE })).toThrow(
      /ANIMUS_ANALYSIS_CATCHING_UP/
    );
  });

  test('a matching analyzed hash transforms/passes through normally', () => {
    const { root } = createRoot(true);
    state.analyzedHashes = new Map([['src/C.tsx', contentHash(OLD_SOURCE)]]);
    expect(runLoader({ root, source: OLD_SOURCE }).output).toBe(OLD_SOURCE);
  });

  test('files with no analyzed identity keep the raw passthrough', () => {
    const { root } = createRoot(true);
    state.analyzedHashes = new Map([
      ['src/Other.tsx', contentHash(OLD_SOURCE)],
    ]);
    expect(runLoader({ root, source: NEW_SOURCE }).output).toBe(NEW_SOURCE);
  });

  test('one refreshed re-check: a publication landing between reads recovers without failing', () => {
    const { root } = createRoot(true);
    const stale = new Map([['src/C.tsx', contentHash(OLD_SOURCE)]]);
    const fresh = new Map([['src/C.tsx', contentHash(NEW_SOURCE)]]);
    let reads = 0;
    // The build's entry is reset after every test.
    Object.defineProperty(state, 'analyzedHashes', {
      configurable: true,
      get: () => (reads++ === 0 ? stale : fresh),
      set: () => {},
    });
    expect(runLoader({ root, source: NEW_SOURCE }).output).toBe(NEW_SOURCE);
    expect(reads).toBeGreaterThanOrEqual(2);
  });
});
