/**
 * Loader epoch dependency + unconditional analyzed-content-hash guard
 * (openspec: next-webpack-served-transform-coherence, design D2/D4 —
 * increment 02).
 *
 * Every dev invocation — transform, raw passthrough, manifest-absent —
 * registers the epoch artifact as a file dependency (the persistent-cache
 * restart witness). When an analyzed file's current source hash mismatches
 * its analyzed hash, the loader fails with the stable diagnostic
 * `ANIMUS_ANALYSIS_CATCHING_UP` after exactly one refreshed re-check —
 * regardless of how many entries the stale manifest holds (the
 * zero-entries→first-chain case must never publish raw bytes). Files with
 * no analyzed identity keep the raw passthrough.
 *
 * Same engine-free harness as loader-css-import.test.ts: globalThis keys
 * drive the singleton; the v2 adapter passes through paths absent from the
 * sent-sources map, so no native engine is involved.
 */
import { contentHash } from '@animus-ui/extract/pipeline';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import animusLoader from '../src/loader';
import { replacementEpochPath, sessionArtifactDir } from '../src/session-paths';

const MANIFEST_KEY = '__animus_manifest_json__';
const ENGINE_KEY = '__animus_engine__';
const V2_ENGINE_KEY = '__animus_v2_engine__';
const V2_SENT_SOURCES_KEY = '__animus_v2_sent_sources__';
const ANALYZED_HASHES_KEY = '__animus_analyzed_hashes__';
const SESSION_DIR_KEY = '__animus_session_artifact_dir__';

/** Fabricated owning-session id for the singleton-published session dir. */
const SESSION_ID = 'loader-epoch-session';

const g = globalThis as Record<string, unknown>;
let saved: Record<string, unknown>;
const tempRoots: string[] = [];

const OLD_SOURCE = 'export const x = 1;\n';
const NEW_SOURCE =
  "export const C = animus.styles({ margin: 8 }).asElement('div');\n";

beforeEach(() => {
  saved = {
    [MANIFEST_KEY]: g[MANIFEST_KEY],
    [ENGINE_KEY]: g[ENGINE_KEY],
    [V2_ENGINE_KEY]: g[V2_ENGINE_KEY],
    [V2_SENT_SOURCES_KEY]: g[V2_SENT_SOURCES_KEY],
    [ANALYZED_HASHES_KEY]: g[ANALYZED_HASHES_KEY],
    [SESSION_DIR_KEY]: g[SESSION_DIR_KEY],
  };
  g[MANIFEST_KEY] = JSON.stringify({ components: {} });
  g[ENGINE_KEY] = 'v2';
  g[V2_ENGINE_KEY] = {
    transformFile: () => {
      throw new Error('engine must not be called for unknown paths');
    },
  };
  g[V2_SENT_SOURCES_KEY] = new Map<string, string>();
  g[ANALYZED_HASHES_KEY] = undefined;
  g[SESSION_DIR_KEY] = undefined;
});

afterEach(() => {
  Object.assign(g, saved);
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

/** Fabricate a project whose owning session published its artifact dir
 *  through the singleton (the loader's source for the session-scoped epoch
 *  dependency path). */
function createRoot(withArtifact: boolean): {
  root: string;
  epochPath: string;
} {
  const root = mkdtempSync(join(tmpdir(), 'animus-loader-epoch-'));
  tempRoots.push(root);
  const sessionDir = sessionArtifactDir(root, SESSION_ID);
  g[SESSION_DIR_KEY] = sessionDir;
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
}): { output: string; dependencies: string[] } {
  const dependencies: string[] = [];
  const ctx = {
    resourcePath: join(args.root, args.relPath ?? 'src/C.tsx'),
    rootContext: args.root,
    getOptions: () => ({}),
    addDependency: (file: string) => {
      dependencies.push(file);
    },
    mode: args.mode ?? ('development' as const),
  };
  const output = animusLoader.call(ctx, args.source);
  return { output, dependencies };
}

describe('epoch artifact file dependency (design D2)', () => {
  test('every dev invocation registers the session-scoped artifact — transform-eligible, passthrough, and manifest-absent alike', () => {
    const { root, epochPath } = createRoot(true);

    // Raw passthrough (no analyzed identity).
    expect(runLoader({ root, source: OLD_SOURCE }).dependencies).toEqual([
      epochPath,
    ]);

    // Manifest-absent passthrough.
    g[MANIFEST_KEY] = undefined;
    const absent = runLoader({ root, source: OLD_SOURCE });
    expect(absent.output).toBe(OLD_SOURCE);
    expect(absent.dependencies).toEqual([epochPath]);
  });

  test('no dependency when the artifact does not exist', () => {
    const { root } = createRoot(false);
    expect(runLoader({ root, source: OLD_SOURCE }).dependencies).toEqual([]);
  });

  test('no dependency when no owning session published a session dir', () => {
    const { root } = createRoot(true);
    g[SESSION_DIR_KEY] = undefined;
    expect(runLoader({ root, source: OLD_SOURCE }).dependencies).toEqual([]);
  });

  test('production invocations never register the artifact (prod untouched)', () => {
    const { root } = createRoot(true);
    const { output, dependencies } = runLoader({
      root,
      source: OLD_SOURCE,
      mode: 'production',
    });
    expect(output).toBe(OLD_SOURCE);
    expect(dependencies).toEqual([]);
  });
});

describe('unconditional analyzed-content-hash guard (design D4)', () => {
  test('an analyzed file whose source hash moved fails with ANIMUS_ANALYSIS_CATCHING_UP', () => {
    const { root } = createRoot(true);
    g[ANALYZED_HASHES_KEY] = new Map([['src/C.tsx', contentHash(OLD_SOURCE)]]);
    expect(() => runLoader({ root, source: NEW_SOURCE })).toThrow(
      /ANIMUS_ANALYSIS_CATCHING_UP: src\/C\.tsx/
    );
  });

  test('zero-entries→first-chain: a file analyzed with no animus entries is never published raw after gaining its first chain', () => {
    const { root } = createRoot(true);
    // The committed analysis saw the file with ZERO entries (manifest holds
    // nothing for it) — extension-relevance consulted on this stale
    // manifest would say "irrelevant"; the guard must fail anyway.
    g[MANIFEST_KEY] = JSON.stringify({ components: {} });
    g[ANALYZED_HASHES_KEY] = new Map([['src/C.tsx', contentHash(OLD_SOURCE)]]);
    expect(() => runLoader({ root, source: NEW_SOURCE })).toThrow(
      /ANIMUS_ANALYSIS_CATCHING_UP/
    );
  });

  test('a matching analyzed hash transforms/passes through normally', () => {
    const { root } = createRoot(true);
    g[ANALYZED_HASHES_KEY] = new Map([['src/C.tsx', contentHash(OLD_SOURCE)]]);
    expect(runLoader({ root, source: OLD_SOURCE }).output).toBe(OLD_SOURCE);
  });

  test('files with no analyzed identity keep the raw passthrough', () => {
    const { root } = createRoot(true);
    g[ANALYZED_HASHES_KEY] = new Map([
      ['src/Other.tsx', contentHash(OLD_SOURCE)],
    ]);
    expect(runLoader({ root, source: NEW_SOURCE }).output).toBe(NEW_SOURCE);
  });

  test('one refreshed re-check: a publication landing between reads recovers without failing', () => {
    const { root } = createRoot(true);
    const stale = new Map([['src/C.tsx', contentHash(OLD_SOURCE)]]);
    const fresh = new Map([['src/C.tsx', contentHash(NEW_SOURCE)]]);
    let reads = 0;
    // Model a watchRun transaction publishing between the loader's first
    // read and its refresh re-check.
    Object.defineProperty(g, ANALYZED_HASHES_KEY, {
      configurable: true,
      get: () => (reads++ === 0 ? stale : fresh),
      set: () => {},
    });
    try {
      expect(runLoader({ root, source: NEW_SOURCE }).output).toBe(NEW_SOURCE);
      expect(reads).toBeGreaterThanOrEqual(2);
    } finally {
      Object.defineProperty(g, ANALYZED_HASHES_KEY, {
        configurable: true,
        writable: true,
        value: undefined,
      });
    }
  });
});
